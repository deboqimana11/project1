//! In-memory LRU cache for decoded or resized pages.

use anyhow::anyhow;
use hashlink::LruCache;

use crate::types::{CacheBudget, ImageKey, PageId};

use super::Result;

/// Cached payload associated with a single page.
#[derive(Debug, Clone)]
pub struct CacheEntry {
    pub page: PageId,
    pub bytes: Vec<u8>,
}

impl CacheEntry {
    pub fn new(page: PageId, bytes: Vec<u8>) -> Self {
        Self { page, bytes }
    }

    fn cost(&self) -> usize {
        self.bytes.len()
    }
}

/// Simple LRU keyed by [`ImageKey`] that evicts based on byte budget.
#[derive(Debug)]
pub struct MemoryCache {
    entries: LruCache<ImageKey, CacheEntry>,
    budget: CacheBudget,
    bytes_used: usize,
}

impl MemoryCache {
    /// Construct a cache with the provided memory budget.
    pub fn new(budget: CacheBudget) -> Self {
        Self { entries: LruCache::new_unbounded(), budget, bytes_used: 0 }
    }

    /// Number of cached entries.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Total memory consumption tracked by the cache.
    pub fn bytes_used(&self) -> usize {
        self.bytes_used
    }

    /// Retrieve an entry, refreshing its recency ordering if present.
    pub fn get(&mut self, key: &ImageKey) -> Option<&CacheEntry> {
        self.entries.get(key)
    }

    /// Insert or replace an entry. Entries larger than the cache budget are ignored.
    pub fn insert(&mut self, key: ImageKey, entry: CacheEntry) -> Result<()> {
        let cost = entry.cost();
        if cost > self.budget.bytes_max {
            // A single oversized entry should not wipe the cache; skip storing it.
            return Ok(());
        }

        if let Some(existing) = self.entries.remove(&key) {
            self.bytes_used = self.bytes_used.saturating_sub(existing.cost());
        }

        self.bytes_used += cost;
        self.entries.insert(key, entry);
        self.evict_if_needed();
        Ok(())
    }

    /// Remove an entry from the cache if present.
    pub fn remove(&mut self, key: &ImageKey) -> Option<CacheEntry> {
        let removed = self.entries.remove(key);
        if let Some(ref entry) = removed {
            self.bytes_used = self.bytes_used.saturating_sub(entry.cost());
        }
        removed
    }

    /// Mark an entry as recently used and ensure the page matches the recorded owner.
    pub fn retain(&mut self, key: &ImageKey, page: &PageId) -> Result<bool> {
        if let Some(entry) = self.entries.get(key) {
            if &entry.page != page {
                return Err(anyhow!(
                    "cache key {:?} mapped to page {:?} but was retained for {:?}",
                    key.cache_key,
                    entry.page,
                    page
                ));
            }
            Ok(true)
        } else {
            Ok(false)
        }
    }

    fn evict_if_needed(&mut self) {
        while self.bytes_used > self.budget.bytes_max {
            if let Some((_key, oldest)) = self.entries.remove_lru() {
                self.bytes_used = self.bytes_used.saturating_sub(oldest.cost());
            } else {
                break;
            }
        }
    }
}

/// Backwards compatible helper used by earlier scaffolding.
pub fn retain(_key: &ImageKey, _page: &PageId) -> Result<()> {
    Ok(())
}
