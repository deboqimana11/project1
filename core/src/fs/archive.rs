//! ZIP/CBZ archive handling.

use std::fs::File;
use std::path::Path;

use anyhow::{Context, anyhow};
use zip::CompressionMethod;
use zip::read::ZipArchive;

use crate::types::{ArchiveEntry, ArchiveKind, PageId, PageMeta, Source, SourceId};

use super::{Result, util};

pub fn load_archive(path: &Path) -> Result<Source> {
    let entries = collect_entries(path)?;
    Ok(Source::Archive { path: path.to_path_buf(), kind: detect_kind(path), entries })
}

pub fn list_archive_pages(path: &Path, source_id: &SourceId) -> Result<Vec<PageMeta>> {
    let entries = collect_entries(path)?;
    let pages = entries
        .into_iter()
        .enumerate()
        .map(|(index, entry)| PageMeta {
            id: PageId { source_id: source_id.clone(), index: index as u32 },
            rel_path: entry.path,
            width: 0,
            height: 0,
            is_double_spread: false,
        })
        .collect();
    Ok(pages)
}

fn collect_entries(path: &Path) -> Result<Vec<ArchiveEntry>> {
    let file = File::open(path).with_context(|| format!("opening archive {:?}", path))?;
    let mut archive = ZipArchive::new(file).map_err(|err| anyhow!("{}", err))?;
    let mut entries: Vec<ArchiveEntry> = Vec::new();

    for idx in 0..archive.len() {
        let file = archive.by_index(idx).map_err(|err| anyhow!("{}", err))?;
        if file.is_dir() {
            continue;
        }

        let Some(enclosed) = file.enclosed_name() else {
            continue;
        };
        let Some(sanitized) = util::sanitize_zip_path(enclosed) else {
            continue;
        };
        if util::is_hidden(&sanitized) || !util::is_supported_image(&sanitized) {
            continue;
        }

        let compression = file.compression();
        entries.push(ArchiveEntry {
            path: sanitized,
            size_bytes: file.size(),
            compressed: compression != CompressionMethod::Stored,
        });
    }

    entries.sort_by(|a, b| util::natural_cmp_path(&a.path, &b.path));
    Ok(entries)
}

fn detect_kind(path: &Path) -> ArchiveKind {
    match path.extension().and_then(|ext| ext.to_str()).map(|s| s.to_ascii_lowercase()) {
        Some(ref ext) if ext == "cbz" || ext == "zip" => ArchiveKind::Zip,
        Some(ref ext) if ext == "cbr" || ext == "rar" => ArchiveKind::Rar,
        Some(ref ext) if ext == "cb7" || ext == "7z" => ArchiveKind::SevenZip,
        Some(ref ext) if ext == "tar" => ArchiveKind::Tar,
        _ => ArchiveKind::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;
    use zip::CompressionMethod;
    use zip::write::FileOptions;

    #[test]
    fn lists_image_entries_in_order() {
        let dir = tempdir().unwrap();
        let archive_path = dir.path().join("demo.cbz");
        create_zip(&archive_path, &["10.jpg", "2.png", "001.jpeg", "notes.txt"]);

        let entries = collect_entries(&archive_path).expect("collect entries");
        let names: Vec<String> = entries
            .iter()
            .map(|entry| normalize_path(entry.path.to_string_lossy().as_ref()))
            .collect();
        assert_eq!(names, vec!["001.jpeg", "2.png", "10.jpg"]);

        let source_id = SourceId::new("zip-1");
        let pages = list_archive_pages(&archive_path, &source_id).expect("list pages");
        assert_eq!(pages.len(), 3);
        assert!(pages.iter().all(|page| page.id.source_id == source_id));
    }

    #[test]
    fn skips_directories_and_hidden_files() {
        let dir = tempdir().unwrap();
        let archive_path = dir.path().join("demo.cbz");
        create_zip(
            &archive_path,
            &["pages/", ".hidden.png", "pages/cover.png", "pages/.thumb.jpg"],
        );

        let entries = collect_entries(&archive_path).expect("collect entries");
        let names: Vec<String> = entries
            .iter()
            .map(|entry| normalize_path(entry.path.to_string_lossy().as_ref()))
            .collect();
        assert_eq!(names, vec!["pages/cover.png"]);
    }

    fn normalize_path(input: &str) -> String {
        input.replace('\\', "/")
    }

    fn create_zip(path: &Path, files: &[&str]) {
        let file = File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = FileOptions::default().compression_method(CompressionMethod::Stored);

        for &name in files {
            if name.ends_with('/') {
                zip.add_directory(name.trim_end_matches('/'), options).unwrap();
            } else {
                zip.start_file(name, options).unwrap();
                zip.write_all(b"demo").unwrap();
            }
        }

        zip.finish().unwrap();
    }
}
