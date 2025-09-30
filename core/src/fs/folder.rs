//! Directory-based source handling and page enumeration.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::anyhow;

use crate::types::{PageId, PageMeta, Source, SourceId};

use super::{Result, util};

/// Construct a [`Source::Folder`] description for the provided `root` directory.
pub fn load_folder(root: &Path) -> Result<Source> {
    let entries = collect_entries(root)?;
    Ok(Source::Folder { root: root.to_path_buf(), entries })
}

/// Enumerate image pages within `root`, sorted using natural ordering semantics.
pub fn list_folder_pages(root: &Path, source_id: &SourceId) -> Result<Vec<PageMeta>> {
    let relative_entries = collect_entries(root)?;

    let pages = relative_entries
        .into_iter()
        .enumerate()
        .map(|(index, rel_path)| PageMeta {
            id: PageId { source_id: source_id.clone(), index: index as u32 },
            rel_path,
            width: 0,
            height: 0,
            is_double_spread: false,
        })
        .collect();

    Ok(pages)
}

fn collect_entries(root: &Path) -> Result<Vec<PathBuf>> {
    if !root.exists() {
        return Err(anyhow!("folder {:?} does not exist", root));
    }
    if !root.is_dir() {
        return Err(anyhow!("folder {:?} is not a directory", root));
    }

    let mut entries: Vec<PathBuf> = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if !file_type.is_file() {
            continue;
        }

        let path = entry.path();
        if util::is_hidden(&path) || !util::is_supported_image(&path) {
            continue;
        }

        let rel = path.strip_prefix(root).unwrap_or_else(|_| path.as_path()).to_path_buf();
        entries.push(rel);
    }

    entries.sort_by(|a, b| util::natural_cmp_path(a, b));
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::SourceId;
    use tempfile::tempdir;

    #[test]
    fn filters_and_sorts_pages() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        let files = ["10.jpg", "2.png", "001.jpeg", "cover.bmp", "notes.txt"];

        for name in files {
            let path = root.join(name);
            fs::write(path, b"test").unwrap();
        }

        let source_id = SourceId::new("folder-1");
        let pages = list_folder_pages(root, &source_id).expect("list pages");

        let order: Vec<String> =
            pages.iter().map(|meta| meta.rel_path.to_string_lossy().into_owned()).collect();
        assert_eq!(order, vec!["001.jpeg", "2.png", "10.jpg", "cover.bmp"]);
        assert!(pages.iter().all(|page| page.id.source_id == source_id));
    }

    #[test]
    fn skips_hidden_and_non_images() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        let files = [".hidden.png", "visible.webp", "thumb.GIF", "README.md"];
        for name in files {
            fs::write(root.join(name), b"test").unwrap();
        }
        let source_id = SourceId::new("folder-2");
        let pages = list_folder_pages(root, &source_id).expect("list pages");
        let names: Vec<String> =
            pages.iter().map(|meta| meta.rel_path.to_string_lossy().into_owned()).collect();
        assert_eq!(names, vec!["thumb.GIF", "visible.webp"]);
    }
}
