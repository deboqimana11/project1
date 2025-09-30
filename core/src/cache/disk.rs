//! Disk-backed cache for resized bitmaps and thumbnails.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{Context, Error, anyhow};
use tempfile::NamedTempFile;

use crate::types::ImageKey;

use super::Result;

const SHARD_LEN: usize = 2;

/// Persists cached image bytes on disk using a sharded directory layout.
#[derive(Debug, Clone)]
pub struct DiskCache {
    root: PathBuf,
}

impl DiskCache {
    /// Create or reuse a disk cache rooted at the provided path.
    pub fn new(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        fs::create_dir_all(&root)
            .with_context(|| format!("creating cache root directory at {}", root.display()))?;
        Ok(Self { root })
    }

    /// Returns the root directory backing the cache.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Resolve the on-disk path associated with an image key.
    pub fn path_for(&self, key: &ImageKey) -> PathBuf {
        let hash = blake3::hash(key.cache_key.as_bytes());
        let hex = hash.to_hex();
        let hex_str = hex.as_str();

        let (shard_one, remainder) = hex_str.split_at(SHARD_LEN);
        let (shard_two, remainder) = remainder.split_at(SHARD_LEN);
        let filename = format!("{remainder}.bin");

        self.root.join(shard_one).join(shard_two).join(filename)
    }

    /// Read cached bytes for the specified key, if present.
    pub fn read(&self, key: &ImageKey) -> Result<Option<Vec<u8>>> {
        let path = self.path_for(key);
        match fs::read(&path) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    /// Persist bytes to disk for the specified key, returning the final path.
    pub fn write(&self, key: &ImageKey, bytes: &[u8]) -> Result<PathBuf> {
        let path = self.path_for(key);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).with_context(|| {
                format!("creating cache shard directory at {}", parent.display())
            })?;
            let mut tmp = NamedTempFile::new_in(parent)
                .with_context(|| format!("allocating temp file in {}", parent.display()))?;
            tmp.write_all(bytes).with_context(|| format!("writing {}", path.display()))?;
            tmp.flush().with_context(|| format!("flushing {}", path.display()))?;
            tmp.persist(&path).map_err(|err| Error::from(err.error))?;
        } else {
            return Err(anyhow!(
                "derived cache path {} does not have a parent directory",
                path.display()
            ));
        }

        Ok(path)
    }

    /// Remove a cached entry if present.
    pub fn remove(&self, key: &ImageKey) -> Result<()> {
        let path = self.path_for(key);
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(err) => Err(err.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::ImageKey;

    #[test]
    fn write_then_read_round_trip() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let cache = DiskCache::new(temp.path())?;
        let key = ImageKey::new("example::key");
        let bytes = vec![0xAA, 0xBB, 0xCC, 0xDD];

        cache.write(&key, &bytes)?;
        let read_back = cache.read(&key)?.expect("cache hit");
        assert_eq!(read_back, bytes);
        Ok(())
    }

    #[test]
    fn missing_entry_returns_none() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let cache = DiskCache::new(temp.path())?;
        let key = ImageKey::new("does::not::exist");

        assert!(cache.read(&key)?.is_none());
        Ok(())
    }

    #[test]
    fn removal_is_idempotent() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let cache = DiskCache::new(temp.path())?;
        let key = ImageKey::new("to::remove");
        cache.write(&key, &[1, 2, 3, 4])?;
        cache.remove(&key)?;
        cache.remove(&key)?; // second deletion should be a no-op
        assert!(cache.read(&key)?.is_none());
        Ok(())
    }

    #[test]
    fn writes_use_sharded_directories() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let cache = DiskCache::new(temp.path())?;
        let key = ImageKey::new("shard::me");

        let path = cache.write(&key, &[9, 9, 9, 9])?;
        assert!(path.exists());
        let relative = path.strip_prefix(cache.root()).unwrap();
        let mut components = relative.components();
        let shard_one = components.next().unwrap().as_os_str().to_str().unwrap().to_string();
        let shard_two = components.next().unwrap().as_os_str().to_str().unwrap().to_string();
        let filename = components.next().unwrap().as_os_str().to_str().unwrap().to_string();
        assert_eq!(shard_one.len(), SHARD_LEN);
        assert_eq!(shard_two.len(), SHARD_LEN);
        assert!(filename.ends_with(".bin"));
        assert!(components.next().is_none());
        Ok(())
    }
}
