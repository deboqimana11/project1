use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

use reader_core::cache::disk::DiskCache;
use reader_core::stats::StatsCollector;
use reader_core::types::ImageKey;

#[derive(Debug, Clone)]
pub struct CachedImage {
    pub bytes: Vec<u8>,
    pub mime: String,
}

#[derive(Debug)]
struct CachedEntry {
    mime: String,
    size: usize,
}

#[derive(Debug)]
pub struct ImageCache {
    disk: DiskCache,
    root: PathBuf,
    index: RwLock<HashMap<String, CachedEntry>>,
    total_bytes: AtomicU64,
    budget_bytes: u64,
    stats: Arc<StatsCollector>,
}

impl ImageCache {
    pub fn new(stats: Arc<StatsCollector>) -> Result<Self, String> {
        let root = default_cache_root();
        Self::with_root(root, stats)
    }

    pub fn with_root(root: PathBuf, stats: Arc<StatsCollector>) -> Result<Self, String> {
        let disk = DiskCache::new(&root).map_err(|err| err.to_string())?;
        Ok(Self {
            disk,
            root,
            index: RwLock::new(HashMap::new()),
            total_bytes: AtomicU64::new(0),
            budget_bytes: reader_core::types::CacheBudget::default().bytes_max as u64,
            stats,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn ensure_bytes<F>(&self, key: &str, mime: &str, producer: F) -> Result<(), String>
    where
        F: FnOnce() -> Result<Vec<u8>, String>,
    {
        if self.disk_path_exists(key) {
            self.record_existing_entry(key, mime);
            self.stats.record_cache_lookup(true);
            return Ok(());
        }

        let bytes = producer()?;
        let image_key = ImageKey::new(key.to_string());
        self.disk.write(&image_key, &bytes).map_err(|err| err.to_string())?;
        self.stats.record_cache_lookup(false);

        let size = bytes.len();
        let mut index = self.index.write().unwrap();
        let previous = index.insert(key.to_string(), CachedEntry { mime: mime.to_string(), size });
        self.adjust_total_bytes(previous.map(|entry| entry.size).unwrap_or(0), size);
        self.publish_usage();
        Ok(())
    }

    pub fn path_for_key(&self, key: &str) -> std::path::PathBuf {
        let image_key = ImageKey::new(key.to_string());
        self.disk.path_for(&image_key)
    }

    pub fn fetch(&self, key: &str) -> Result<Option<CachedImage>, String> {
        let image_key = ImageKey::new(key.to_string());
        match self.disk.read(&image_key).map_err(|err| err.to_string())? {
            Some(bytes) => {
                self.stats.record_cache_lookup(true);
                let mime = self.mime_for(key, bytes.len());
                Ok(Some(CachedImage { bytes, mime }))
            }
            None => {
                self.stats.record_cache_lookup(false);
                Ok(None)
            }
        }
    }

    fn mime_for(&self, key: &str, size_hint: usize) -> String {
        if let Some(entry) = self.index.read().unwrap().get(key) {
            return entry.mime.clone();
        }

        let mut index = self.index.write().unwrap();
        index
            .entry(key.to_string())
            .or_insert_with(|| {
                self.adjust_total_bytes(0, size_hint);
                CachedEntry { mime: "image/png".to_string(), size: size_hint }
            })
            .mime
            .clone()
    }

    fn disk_path_exists(&self, key: &str) -> bool {
        let image_key = ImageKey::new(key.to_string());
        self.disk.path_for(&image_key).exists()
    }

    fn record_existing_entry(&self, key: &str, mime: &str) {
        let mut index = self.index.write().unwrap();
        if let Some(entry) = index.get_mut(key) {
            entry.mime = mime.to_string();
            return;
        }

        let image_key = ImageKey::new(key.to_string());
        let path = self.disk.path_for(&image_key);
        let size = std::fs::metadata(&path).map(|meta| meta.len() as usize).unwrap_or(0);
        index.insert(key.to_string(), CachedEntry { mime: mime.to_string(), size });
        self.adjust_total_bytes(0, size);
        self.publish_usage();
    }

    fn adjust_total_bytes(&self, previous: usize, current: usize) {
        let prev = previous as i64;
        let curr = current as i64;
        let delta = curr - prev;
        if delta > 0 {
            self.total_bytes.fetch_add(delta as u64, Ordering::Relaxed);
        } else if delta < 0 {
            self.total_bytes.fetch_sub(delta.unsigned_abs(), Ordering::Relaxed);
        }
    }

    fn publish_usage(&self) {
        let used = self.total_bytes.load(Ordering::Relaxed);
        self.stats.update_cache_usage(used, self.budget_bytes);
    }
}

fn default_cache_root() -> PathBuf {
    if let Some(dirs) =
        directories::ProjectDirs::from("com", "LocalComicReader", "local-comic-reader")
    {
        let mut path = dirs.data_dir().to_path_buf();
        path.push("cache");
        path
    } else {
        std::env::temp_dir().join("local-comic-reader-cache")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_and_reads_round_trip() {
        let temp = tempfile::tempdir().unwrap();
        let stats = Arc::new(StatsCollector::new());
        let cache = ImageCache::with_root(temp.path().join("cache"), Arc::clone(&stats)).unwrap();
        let key = "demo-key";
        cache.ensure_bytes(key, "image/png", || Ok(vec![1, 2, 3, 4])).expect("store bytes");

        let fetched = cache.fetch(key).expect("fetch").expect("hit");
        assert_eq!(fetched.bytes, vec![1, 2, 3, 4]);
        assert_eq!(fetched.mime, "image/png");

        let snapshot = stats.snapshot();
        assert_eq!(snapshot.cache_requests, 2);
        assert!(snapshot.cache_hit_ratio > 0.0);
    }
}
