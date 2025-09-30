//! Persistent storage for reading progress data.

use std::collections::HashMap;
use std::fs;
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::anyhow;
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use tempfile::NamedTempFile;

use crate::types::{PageId, SourceId};

use super::Result;

const APP_QUALIFIER: &str = "com";
const APP_ORGANISATION: &str = "LocalComicReader";
const APP_NAME: &str = "local-comic-reader";

#[derive(Debug)]
struct ProgressStorage {
    path: PathBuf,
    lock: Mutex<()>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct ProgressFile {
    entries: HashMap<String, ProgressEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProgressEntry {
    page_index: u32,
    updated_ms: u64,
}

static STORAGE: OnceLock<ProgressStorage> = OnceLock::new();

/// Load the last saved page for the given source, if available.
pub fn load(source: &SourceId) -> Result<Option<PageId>> {
    let storage = storage()?;
    let _guard = storage.lock.lock().expect("progress mutex poisoned");
    let file = read_file(storage)?;
    Ok(file
        .entries
        .get(source.as_str())
        .map(|entry| PageId { source_id: source.clone(), index: entry.page_index }))
}

/// Persist the given page as the latest progress for its source.
pub fn save(page: &PageId) -> Result<()> {
    let storage = storage()?;
    let _guard = storage.lock.lock().expect("progress mutex poisoned");
    let mut file = read_file(storage)?;
    file.entries.insert(
        page.source_id.as_str().to_string(),
        ProgressEntry { page_index: page.index, updated_ms: now_ms() },
    );
    write_file(storage, &file)
}

fn storage() -> Result<&'static ProgressStorage> {
    if let Some(storage) = STORAGE.get() {
        return Ok(storage);
    }

    let dir = progress_dir()?;
    fs::create_dir_all(&dir)?;
    let path = dir.join("progress.json");
    let storage = ProgressStorage { path, lock: Mutex::new(()) };

    STORAGE.set(storage).map_err(|_| anyhow!("progress storage already initialised"))?;
    Ok(STORAGE.get().expect("progress storage set"))
}

fn progress_dir() -> Result<PathBuf> {
    ProjectDirs::from(APP_QUALIFIER, APP_ORGANISATION, APP_NAME)
        .map(|dirs| dirs.data_dir().join("state"))
        .ok_or_else(|| anyhow!("unable to resolve application data directory"))
}

fn read_file(storage: &ProgressStorage) -> Result<ProgressFile> {
    match fs::read(&storage.path) {
        Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(ProgressFile::default()),
        Err(err) => Err(err.into()),
    }
}

fn write_file(storage: &ProgressStorage, file: &ProgressFile) -> Result<()> {
    if let Some(parent) = storage.path.parent() {
        fs::create_dir_all(parent)?;
        let data = serde_json::to_vec_pretty(file)?;
        let mut temp = NamedTempFile::new_in(parent)?;
        temp.write_all(&data)?;
        temp.flush()?;
        let target = storage.path.clone();
        match temp.persist(&target) {
            Ok(_) => Ok(()),
            Err(err) => {
                if err.error.kind() == io::ErrorKind::AlreadyExists {
                    if let Err(remove_err) = fs::remove_file(&target) {
                        if remove_err.kind() != io::ErrorKind::NotFound {
                            return Err(remove_err.into());
                        }
                    }
                    err.file
                        .persist(&target)
                        .map(|_| ())
                        .map_err(|persist_err| persist_err.error.into())
                } else {
                    Err(err.error.into())
                }
            }
        }
    } else {
        Err(anyhow!("progress path {} does not have a parent directory", storage.path.display()))
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::OnceLock;

    static TEST_STORAGE: OnceLock<ProgressStorage> = OnceLock::new();

    fn setup_temp() -> ProgressStorage {
        let dir = tempfile::tempdir().expect("tempdir");
        ProgressStorage { path: dir.path().join("progress.json"), lock: Mutex::new(()) }
    }

    fn test_storage() -> &'static ProgressStorage {
        TEST_STORAGE.get_or_init(|| setup_temp())
    }

    #[test]
    fn writes_and_reads_progress() {
        let storage = test_storage();
        if storage.path.exists() {
            fs::remove_file(&storage.path).unwrap();
        }

        let source = SourceId::new("demo");
        let page = PageId { source_id: source.clone(), index: 42 };

        {
            let mut file = ProgressFile::default();
            file.entries.insert(
                source.as_str().to_string(),
                ProgressEntry { page_index: page.index, updated_ms: now_ms() },
            );
            write_file(storage, &file).unwrap();
        }

        let stored = read_file(storage).unwrap();
        let entry = stored.entries.get(source.as_str()).unwrap();
        assert_eq!(entry.page_index, 42);
    }
}
