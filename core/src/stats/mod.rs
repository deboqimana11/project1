//! Runtime performance counters and developer-facing statistics.
//!
//! The reader exposes lightweight hooks for recording frame cadence, decode latency, and cache
//! effectiveness. The collected data powers the `stats` IPC command used by the developer HUD.

use std::cmp::Ordering;
use std::collections::VecDeque;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tracing::warn;

const DEFAULT_SAMPLE_CAPACITY: usize = 240;

#[derive(Debug, Default)]
struct SampleWindow {
    samples: VecDeque<f32>,
    capacity: usize,
}

impl SampleWindow {
    fn new(capacity: usize) -> Self {
        Self { samples: VecDeque::with_capacity(capacity), capacity }
    }

    fn push(&mut self, value: f32) {
        if self.samples.len() == self.capacity {
            self.samples.pop_front();
        }
        self.samples.push_back(value);
    }

    fn percentile(&self, percentile: f32) -> f32 {
        if self.samples.is_empty() {
            return 0.0;
        }

        let mut sorted: Vec<f32> = self.samples.iter().copied().collect();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));

        let rank = percentile.clamp(0.0, 1.0) * (sorted.len() - 1) as f32;
        let index = rank.round() as usize;
        sorted.get(index).copied().unwrap_or(0.0)
    }

    fn mean(&self) -> f32 {
        if self.samples.is_empty() {
            return 0.0;
        }
        let sum: f32 = self.samples.iter().copied().sum();
        sum / self.samples.len() as f32
    }
}

#[derive(Debug)]
struct StatsInner {
    started_at: Instant,
    frame_times_ms: SampleWindow,
    decode_times_ms: SampleWindow,
    cache_requests: u64,
    cache_hits: u64,
    cache_bytes_used: u64,
    cache_bytes_capacity: u64,
    prefetch_pending: usize,
}

impl Default for StatsInner {
    fn default() -> Self {
        Self {
            started_at: Instant::now(),
            frame_times_ms: SampleWindow::new(DEFAULT_SAMPLE_CAPACITY),
            decode_times_ms: SampleWindow::new(DEFAULT_SAMPLE_CAPACITY),
            cache_requests: 0,
            cache_hits: 0,
            cache_bytes_used: 0,
            cache_bytes_capacity: 0,
            prefetch_pending: 0,
        }
    }
}

/// Thread-safe counter collection consumed by the developer instrumentation.
#[derive(Debug, Default)]
pub struct StatsCollector {
    inner: parking_lot::Mutex<StatsInner>,
}

impl StatsCollector {
    /// Create a new collector with default sampling capacity.
    pub fn new() -> Self {
        Self::default()
    }

    /// Record the time taken to present a frame.
    pub fn record_frame(&self, duration: Duration) {
        let mut guard = self.inner.lock();
        guard.frame_times_ms.push(duration.as_secs_f64() as f32 * 1_000.0);
    }

    /// Record the time spent decoding or preparing an image for display.
    pub fn record_decode(&self, duration: Duration) {
        let mut guard = self.inner.lock();
        guard.decode_times_ms.push(duration.as_secs_f64() as f32 * 1_000.0);
    }

    /// Record whether a cache lookup produced a hit.
    pub fn record_cache_lookup(&self, hit: bool) {
        let mut guard = self.inner.lock();
        guard.cache_requests = guard.cache_requests.saturating_add(1);
        if hit {
            guard.cache_hits = guard.cache_hits.saturating_add(1);
        }
    }

    /// Update the aggregate cache usage counters.
    pub fn update_cache_usage(&self, used_bytes: u64, capacity_bytes: u64) {
        let mut guard = self.inner.lock();
        guard.cache_bytes_used = used_bytes;
        guard.cache_bytes_capacity = capacity_bytes;
    }

    /// Update the number of pending prefetch operations.
    pub fn update_prefetch_pending(&self, pending: usize) {
        let mut guard = self.inner.lock();
        guard.prefetch_pending = pending;
    }

    /// Generate a snapshot of the current metrics for presentation to the UI.
    pub fn snapshot(&self) -> PerfSnapshot {
        let guard = self.inner.lock();

        let uptime = guard.started_at.elapsed();
        let frame_mean = guard.frame_times_ms.mean();
        let fps = if frame_mean > f32::EPSILON { 1_000.0 / frame_mean } else { 0.0 };

        let cache_requests = guard.cache_requests.max(1);
        let cache_hit_ratio = guard.cache_hits as f32 / cache_requests as f32;

        PerfSnapshot {
            timestamp_ms: now_ms(),
            uptime_ms: uptime.as_millis() as u64,
            fps,
            frame_time_ms_p50: guard.frame_times_ms.percentile(0.50),
            frame_time_ms_p95: guard.frame_times_ms.percentile(0.95),
            decode_time_ms_p50: guard.decode_times_ms.percentile(0.50),
            decode_time_ms_p95: guard.decode_times_ms.percentile(0.95),
            cache_hit_ratio,
            cache_requests: guard.cache_requests,
            cache_bytes_used: guard.cache_bytes_used,
            cache_bytes_capacity: guard.cache_bytes_capacity,
            prefetch_pending: guard.prefetch_pending,
        }
    }
}

fn now_ms() -> u64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(delta) => delta.as_millis() as u64,
        Err(err) => {
            warn!("system clock error: {err}");
            0
        }
    }
}

/// Immutable snapshot returned to the UI layer.
#[derive(Debug, Clone, Serialize)]
pub struct PerfSnapshot {
    pub timestamp_ms: u64,
    pub uptime_ms: u64,
    pub fps: f32,
    pub frame_time_ms_p50: f32,
    pub frame_time_ms_p95: f32,
    pub decode_time_ms_p50: f32,
    pub decode_time_ms_p95: f32,
    pub cache_hit_ratio: f32,
    pub cache_requests: u64,
    pub cache_bytes_used: u64,
    pub cache_bytes_capacity: u64,
    pub prefetch_pending: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn percentile_and_mean_are_computed() {
        let collector = StatsCollector::new();
        collector.record_frame(Duration::from_millis(10));
        collector.record_frame(Duration::from_millis(20));
        collector.record_frame(Duration::from_millis(30));

        let snap = collector.snapshot();
        assert!(snap.fps > 40.0 && snap.fps < 120.0);
        assert!(snap.frame_time_ms_p50 >= 10.0);
    }

    #[test]
    fn cache_metrics_are_tracked() {
        let collector = StatsCollector::new();
        collector.record_cache_lookup(true);
        collector.record_cache_lookup(false);
        collector.update_cache_usage(128 * 1024 * 1024, 512 * 1024 * 1024);
        collector.update_prefetch_pending(3);

        let snap = collector.snapshot();
        assert_eq!(snap.cache_requests, 2);
        assert!(snap.cache_hit_ratio > 0.0 && snap.cache_hit_ratio < 1.0);
        assert_eq!(snap.cache_bytes_used, 128 * 1024 * 1024);
        assert_eq!(snap.prefetch_pending, 3);
    }
}
