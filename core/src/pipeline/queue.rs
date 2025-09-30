//! Prefetch queue and prioritization logic for decode tasks.

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, HashSet};

use crate::types::{PageId, PrefetchPolicy, RequestToken};

use super::Result;

/// Represents a scheduled prefetch operation.
#[derive(Debug, Clone, PartialEq)]
pub struct PrefetchTask {
    pub page: PageId,
    pub distance: i32,
    pub priority: f64,
}

impl PrefetchTask {
    fn new(page: PageId, distance: i32, priority: f64) -> Self {
        Self { page, distance, priority }
    }
}

#[derive(Debug, Copy, Clone)]
struct QueuePriority {
    value: f64,
    sequence: u64,
}

impl Eq for QueuePriority {}

impl PartialEq for QueuePriority {
    fn eq(&self, other: &Self) -> bool {
        self.value == other.value && self.sequence == other.sequence
    }
}

impl Ord for QueuePriority {
    fn cmp(&self, other: &Self) -> Ordering {
        match self.value.partial_cmp(&other.value) {
            Some(ordering) => ordering.then_with(|| self.sequence.cmp(&other.sequence)),
            None => Ordering::Equal,
        }
    }
}

impl PartialOrd for QueuePriority {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Debug)]
struct QueueEntry {
    priority: QueuePriority,
    task: PrefetchTask,
}

impl Eq for QueueEntry {}

impl PartialEq for QueueEntry {
    fn eq(&self, other: &Self) -> bool {
        self.priority == other.priority
    }
}

impl Ord for QueueEntry {
    fn cmp(&self, other: &Self) -> Ordering {
        self.priority.cmp(&other.priority)
    }
}

impl PartialOrd for QueueEntry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// Priority queue producing decode/prefetch tasks ordered by relevance.
#[derive(Debug, Default)]
pub struct PrefetchQueue {
    pending: BinaryHeap<QueueEntry>,
    queued: HashSet<PageId>,
    active: HashMap<RequestToken, PageId>,
    active_pages: HashSet<PageId>,
    sequence: u64,
    next_token: u64,
}

impl PrefetchQueue {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.queued.len()
    }

    pub fn is_empty(&self) -> bool {
        self.queued.is_empty()
    }

    pub fn clear(&mut self) {
        self.pending.clear();
        self.queued.clear();
        self.active.clear();
        self.active_pages.clear();
    }

    /// Rebuild the queue around a new center page, applying the given policy and viewport velocity.
    pub fn plan_window(
        &mut self,
        center: &PageId,
        total_pages: u32,
        policy: PrefetchPolicy,
        velocity: f32,
    ) -> Result<()> {
        self.pending.clear();
        self.queued.clear();

        if total_pages == 0 {
            return Ok(());
        }

        let center_index = center.index;

        let start = center_index.saturating_sub(policy.behind.min(center_index));
        let end = (center_index + policy.ahead).min(total_pages.saturating_sub(1));

        for index in start..=end {
            if index == center_index {
                continue;
            }

            let distance = index as i32 - center_index as i32;
            let priority = compute_priority(distance, velocity);
            if priority <= 0.0 {
                continue;
            }

            let page = PageId { source_id: center.source_id.clone(), index };
            if self.active_pages.contains(&page) {
                continue;
            }
            self.push_task(page, distance, priority);
        }

        Ok(())
    }

    /// Remove and return the next highest-priority task, issuing a cancellation token.
    pub fn next_task(&mut self) -> Option<(RequestToken, PrefetchTask)> {
        while let Some(entry) = self.pending.pop() {
            if self.queued.remove(&entry.task.page) {
                let token = self.allocate_token();
                self.active.insert(token, entry.task.page.clone());
                self.active_pages.insert(entry.task.page.clone());
                return Some((token, entry.task));
            }
        }
        None
    }

    /// Mark an issued task as completed, releasing its token and allowing the page to be scheduled again.
    pub fn complete(&mut self, token: &RequestToken) -> bool {
        if let Some(page) = self.active.remove(token) {
            self.active_pages.remove(&page);
            true
        } else {
            false
        }
    }

    /// Cancel an in-flight task identified by the token.
    pub fn cancel(&mut self, token: &RequestToken) -> bool {
        self.complete(token)
    }

    fn push_task(&mut self, page: PageId, distance: i32, priority: f64) {
        if !self.queued.insert(page.clone()) {
            return;
        }

        self.sequence = self.sequence.wrapping_add(1);
        let entry = QueueEntry {
            priority: QueuePriority { value: priority, sequence: self.sequence },
            task: PrefetchTask::new(page, distance, priority),
        };

        self.pending.push(entry);
    }

    fn allocate_token(&mut self) -> RequestToken {
        self.next_token = self.next_token.wrapping_add(1).max(1);
        RequestToken::new(self.next_token)
    }
}

fn compute_priority(distance: i32, velocity: f32) -> f64 {
    let abs_distance = distance.abs() as f64;
    let distance_weight = 1.0 / (abs_distance + 1.0);

    let speed = velocity.abs() as f64;
    let direction_alignment = if distance == 0 || speed == 0.0 {
        0.0
    } else {
        (distance.signum() as f64) * (velocity.signum() as f64)
    };

    let directional_weight = direction_alignment * (speed.min(4.0) / 8.0);
    let score = (distance_weight + directional_weight).max(0.0);
    if score.is_finite() { score } else { 0.0 }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::SourceId;

    fn page(source: &str, index: u32) -> PageId {
        PageId { source_id: SourceId::new(source), index }
    }

    #[test]
    fn prioritizes_closer_pages() {
        let center = page("demo", 10);
        let mut queue = PrefetchQueue::new();
        queue.plan_window(&center, 30, PrefetchPolicy { ahead: 3, behind: 2 }, 0.0).unwrap();

        let priorities: Vec<_> = (0..queue.len()).filter_map(|_| queue.next_task()).collect();
        let distances: Vec<i32> = priorities.iter().map(|(_, task)| task.distance).collect();
        assert_eq!(distances, vec![1, -1, 2, -2, 3]);
    }

    #[test]
    fn forward_velocity_biases_future_pages() {
        let center = page("demo", 5);
        let mut queue = PrefetchQueue::new();
        queue.plan_window(&center, 20, PrefetchPolicy { ahead: 3, behind: 3 }, 2.5).unwrap();

        let distances: Vec<i32> =
            (0..queue.len()).filter_map(|_| queue.next_task()).map(|(_, t)| t.distance).collect();

        assert!(
            distances.iter().position(|&d| d > 0).unwrap()
                < distances.iter().position(|&d| d < 0).unwrap()
        );
        assert_eq!(distances[0], 1);
    }

    #[test]
    fn backward_velocity_prioritizes_previous_pages() {
        let center = page("demo", 8);
        let mut queue = PrefetchQueue::new();
        queue.plan_window(&center, 50, PrefetchPolicy { ahead: 3, behind: 3 }, -3.0).unwrap();

        let first = queue.next_task().unwrap();
        assert!(first.1.distance < 0);
    }

    #[test]
    fn deduplicates_pages_and_handles_cancellation() {
        let center = page("demo", 2);
        let mut queue = PrefetchQueue::new();
        queue.plan_window(&center, 10, PrefetchPolicy { ahead: 2, behind: 2 }, 1.0).unwrap();
        let len_first = queue.len();
        queue.plan_window(&center, 10, PrefetchPolicy { ahead: 2, behind: 2 }, 1.0).unwrap();
        assert_eq!(queue.len(), len_first);

        let (token, _) = queue.next_task().unwrap();
        assert!(queue.cancel(&token));
        assert!(!queue.cancel(&token));
    }

    #[test]
    fn complete_releases_page_for_future_scheduling() {
        let center = page("demo", 1);
        let mut queue = PrefetchQueue::new();
        queue.plan_window(&center, 5, PrefetchPolicy { ahead: 2, behind: 0 }, 0.0).unwrap();

        let (token, task) = queue.next_task().unwrap();
        assert!(queue.complete(&token));
        assert!(!queue.complete(&token));

        queue.plan_window(&center, 5, PrefetchPolicy { ahead: 2, behind: 0 }, 0.0).unwrap();
        let distances: Vec<i32> =
            (0..queue.len()).filter_map(|_| queue.next_task()).map(|(_, t)| t.distance).collect();
        assert!(distances.contains(&task.distance));
    }
}
