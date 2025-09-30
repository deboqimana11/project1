use crate::image_cache::ImageCache;
use reader_core::fs::{archive as fs_archive, folder as fs_folder};
use reader_core::stats::{PerfSnapshot, StatsCollector};
use reader_core::store::progress as progress_store;
use reader_core::types::{PageId as CorePageId, SourceId as CoreSourceId};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use tauri::State;

pub struct AppState {
    cache: Arc<ImageCache>,
    metrics: Arc<StatsCollector>,
    inner: Mutex<InnerState>,
}

#[derive(Default)]
struct InnerState {
    next_source_id: u64,
    sources: HashMap<String, SourceData>,
    pending_prefetch: HashSet<String>,
}

#[derive(Clone, Debug)]
enum SourceKind {
    Folder { root: std::path::PathBuf },
    Archive { path: std::path::PathBuf },
    SingleFile { path: std::path::PathBuf },
    Mock,
}

#[derive(Clone, Debug)]
struct SourceData {
    kind: SourceKind,
    pages: Vec<PageMeta>,
}

impl AppState {
    pub fn new(cache: Arc<ImageCache>, metrics: Arc<StatsCollector>) -> Self {
        Self { cache, metrics, inner: Mutex::new(InnerState::default()) }
    }

    fn with_lock<F, T>(&self, f: F) -> Result<T, String>
    where
        F: FnOnce(&mut InnerState) -> Result<T, String>,
    {
        let mut guard = self.inner.lock().map_err(|_| "internal state poisoned".to_string())?;
        f(&mut guard)
    }

    fn cache(&self) -> Arc<ImageCache> {
        Arc::clone(&self.cache)
    }

    fn stats(&self) -> Arc<StatsCollector> {
        Arc::clone(&self.metrics)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SourceId(pub String);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageId {
    pub source_id: SourceId,
    pub index: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageMeta {
    pub id: PageId,
    pub rel_path: String,
    pub width: u32,
    pub height: u32,
    pub is_double_spread: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FitMode {
    FitWidth,
    FitHeight,
    FitContain,
    Original,
    Fill,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderParams {
    pub fit: FitMode,
    pub viewport_w: u32,
    pub viewport_h: u32,
    pub scale: f32,
    pub rotation: i16,
    pub dpi: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrefetchPolicy {
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RequestToken(pub String);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfStats {
    #[serde(flatten)]
    pub snapshot: PerfSnapshot,
    pub active_sources: usize,
    pub cached_pages: usize,
}

fn mock_pages(source_id: &SourceId, path: &str) -> Vec<PageMeta> {
    let base_name =
        std::path::Path::new(path).file_name().and_then(|os| os.to_str()).unwrap_or("demo");

    (0..5)
        .map(|idx| PageMeta {
            id: PageId { source_id: source_id.clone(), index: idx },
            rel_path: format!("{base_name}/page_{idx:03}.png"),
            width: 1600,
            height: 2400,
            is_double_spread: idx % 3 == 2,
        })
        .collect()
}

fn format_image_key(source: &SourceId, index: u32) -> String {
    format!("{}-page-{index}", source.0)
}

const MIME_PNG: &str = "image/png";
const PLACEHOLDER_BYTES: &[u8] = include_bytes!("../assets/placeholder.png");

fn is_supported_image(path: &std::path::Path) -> bool {
    reader_core::fs::is_supported_image(path)
}

fn is_supported_archive(path: &std::path::Path) -> bool {
    match path.extension().and_then(|e| e.to_str()).map(|s| s.to_ascii_lowercase()) {
        Some(ext) if ext == "zip" || ext == "cbz" => true,
        _ => false,
    }
}

fn guess_mime(path: &std::path::Path) -> &str {
    match path.extension().and_then(|e| e.to_str()).map(|s| s.to_ascii_lowercase()) {
        Some(ext) if ext == "jpg" || ext == "jpeg" => "image/jpeg",
        Some(ext) if ext == "png" => "image/png",
        Some(ext) if ext == "webp" => "image/webp",
        Some(ext) if ext == "avif" => "image/avif",
        Some(ext) if ext == "gif" => "image/gif",
        Some(ext) if ext == "bmp" => "image/bmp",
        _ => "application/octet-stream",
    }
}

#[tauri::command]
pub fn open_path(path: String, state: State<AppState>) -> Result<SourceId, String> {
    use std::path::Path;

    // Demo shortcut preserved for UI preview
    if path == "demo-bundle" {
        return state.with_lock(|inner| {
            inner.next_source_id += 1;
            let id = SourceId(format!("src-{}", inner.next_source_id));
            let pages = mock_pages(&id, &path);
            inner.sources.insert(id.0.clone(), SourceData { kind: SourceKind::Mock, pages });
            Ok(id)
        });
    }

    let path_ref = Path::new(&path);
    let source_result = if path_ref.is_dir() {
        let id = state.with_lock(|inner| {
            inner.next_source_id += 1;
            Ok(SourceId(format!("src-{}", inner.next_source_id)))
        })?;

        let pages = fs_folder::list_folder_pages(path_ref, &CoreSourceId::new(id.0.clone()))
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|m| PageMeta {
                id: PageId { source_id: id.clone(), index: m.id.index },
                rel_path: m.rel_path.to_string_lossy().to_string(),
                width: m.width,
                height: m.height,
                is_double_spread: m.is_double_spread,
            })
            .collect::<Vec<_>>();

        state.with_lock(|inner| {
            inner.sources.insert(
                id.0.clone(),
                SourceData {
                    kind: SourceKind::Folder { root: path_ref.to_path_buf() },
                    pages: pages.clone(),
                },
            );
            Ok(id)
        })
    } else if path_ref.is_file() && is_supported_archive(path_ref) {
        let id = state.with_lock(|inner| {
            inner.next_source_id += 1;
            Ok(SourceId(format!("src-{}", inner.next_source_id)))
        })?;

        let pages = fs_archive::list_archive_pages(path_ref, &CoreSourceId::new(id.0.clone()))
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|m| PageMeta {
                id: PageId { source_id: id.clone(), index: m.id.index },
                rel_path: m.rel_path.to_string_lossy().to_string(),
                width: m.width,
                height: m.height,
                is_double_spread: m.is_double_spread,
            })
            .collect::<Vec<_>>();

        state.with_lock(|inner| {
            inner.sources.insert(
                id.0.clone(),
                SourceData {
                    kind: SourceKind::Archive { path: path_ref.to_path_buf() },
                    pages: pages.clone(),
                },
            );
            Ok(id)
        })
    } else if path_ref.is_file() && is_supported_image(path_ref) {
        let id = state.with_lock(|inner| {
            inner.next_source_id += 1;
            Ok(SourceId(format!("src-{}", inner.next_source_id)))
        })?;

        let file_name =
            path_ref.file_name().and_then(|os| os.to_str()).unwrap_or("image").to_string();
        let page = PageMeta {
            id: PageId { source_id: id.clone(), index: 0 },
            rel_path: file_name,
            width: 0,
            height: 0,
            is_double_spread: false,
        };

        state.with_lock(|inner| {
            inner.sources.insert(
                id.0.clone(),
                SourceData {
                    kind: SourceKind::SingleFile { path: path_ref.to_path_buf() },
                    pages: vec![page.clone()],
                },
            );
            Ok(id)
        })
    } else {
        Err("Unsupported path. Select a folder, an image file or a CBZ/ZIP archive.".to_string())
    }?;

    Ok(source_result)
}

#[tauri::command]
pub fn list_pages(source_id: SourceId, state: State<AppState>) -> Result<Vec<PageMeta>, String> {
    state.with_lock(|inner| {
        inner
            .sources
            .get(&source_id.0)
            .map(|src| {
                tracing::debug!(target: "commands::list_pages", source = %source_id.0, "listed pages");
                src.pages.clone()
            })
            .ok_or_else(|| "unknown source".to_string())
    })
}

#[tauri::command]
pub fn get_page_url(
    page: PageId,
    params: RenderParams,
    state: State<AppState>,
) -> Result<String, String> {
    let cache = state.cache();

    enum FetchTask {
        Disk(std::path::PathBuf),
        Archive { archive_path: std::path::PathBuf, inner: String },
        Mock,
    }

    let (key, mime, task) = state.with_lock(|inner| {
        let src = inner.sources.get(&page.source_id.0).ok_or_else(|| "unknown page".to_string())?;
        let key = format_image_key(&page.source_id, page.index);
        tracing::debug!(
            target: "commands::get_page_url",
            source = %page.source_id.0,
            index = page.index,
            fit = ?params.fit,
            "resolved page url"
        );
        let rel =
            src.pages.get(page.index as usize).map(|m| m.rel_path.clone()).unwrap_or_default();

        match &src.kind {
            SourceKind::Folder { root } => {
                let full = std::path::Path::new(root).join(&rel);
                let mime = guess_mime(&full).to_string();
                Ok((key, mime, FetchTask::Disk(full)))
            }
            SourceKind::SingleFile { path } => {
                let mime = guess_mime(path).to_string();
                Ok((key, mime, FetchTask::Disk(path.clone())))
            }
            SourceKind::Archive { path } => {
                let inside = rel.replace('\\', "/");
                let mime = guess_mime(std::path::Path::new(&inside)).to_string();
                Ok((key, mime, FetchTask::Archive { archive_path: path.clone(), inner: inside }))
            }
            SourceKind::Mock => Ok((key, MIME_PNG.to_string(), FetchTask::Mock)),
        }
    })?;

    cache.ensure_bytes(&key, &mime, || match task {
        FetchTask::Disk(full) => std::fs::read(&full).map_err(|e| e.to_string()),
        FetchTask::Archive { archive_path, inner } => {
            use std::fs::File;
            use std::io::Read;
            let file = File::open(&archive_path).map_err(|e| e.to_string())?;
            let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
            let mut bytes = Vec::new();
            if let Ok(mut entry) = zip.by_name(&inner) {
                entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
                return Ok(bytes);
            }
            for i in 0..zip.len() {
                let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
                if let Some(enclosed) = entry.enclosed_name() {
                    let p = enclosed.to_string_lossy().replace('\\', "/");
                    if p == inner {
                        entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
                        return Ok(bytes);
                    }
                }
            }
            Err("entry not found in archive".to_string())
        }
        FetchTask::Mock => Ok(PLACEHOLDER_BYTES.to_vec()),
    })?;

    Ok(format!("asset://localhost/img/{key}"))
}

#[tauri::command]
pub fn get_thumb_url(page: PageId, longest: u32, state: State<AppState>) -> Result<String, String> {
    let cache = state.cache();

    let key = state.with_lock(|inner| {
        if inner.sources.contains_key(&page.source_id.0) {
            let key = format!("{}-thumb-{}-{}", page.source_id.0, page.index, longest);
            tracing::debug!(
                target: "commands::get_thumb_url",
                source = %page.source_id.0,
                index = page.index,
                longest,
                "resolved thumbnail url"
            );
            Ok(key)
        } else {
            Err("unknown page".to_string())
        }
    })?;

    // For now, reuse full image bytes as thumbnail; pipeline can be added later.
    let _ = get_page_url(
        page.clone(),
        RenderParams {
            fit: FitMode::FitContain,
            viewport_w: longest,
            viewport_h: longest,
            scale: 1.0,
            rotation: 0,
            dpi: 96.0,
        },
        state,
    )?;
    if cache.fetch(&key)?.is_none() {
        if let Some(img) = cache.fetch(&format_image_key(&page.source_id, page.index))? {
            cache.ensure_bytes(&key, &img.mime, || Ok(img.bytes))?;
        } else {
            cache.ensure_bytes(&key, MIME_PNG, || Ok(PLACEHOLDER_BYTES.to_vec()))?;
        }
    }

    Ok(format!("asset://localhost/img/{key}"))
}

#[tauri::command]
pub fn prefetch(
    center: PageId,
    policy: PrefetchPolicy,
    state: State<AppState>,
) -> Result<(), String> {
    let pending = state.with_lock(|inner| {
        if inner.sources.contains_key(&center.source_id.0) {
            let token = format!("prefetch-{}-{}", center.source_id.0, center.index);
            inner.pending_prefetch.insert(token);
            tracing::debug!(
                target: "commands::prefetch",
                source = %center.source_id.0,
                index = center.index,
                ahead = policy.ahead,
                behind = policy.behind,
                "scheduled prefetch"
            );
            Ok(inner.pending_prefetch.len())
        } else {
            Err("unknown source for prefetch".to_string())
        }
    })?;

    state.stats().update_prefetch_pending(pending);
    Ok(())
}

#[tauri::command]
pub fn cancel(token: RequestToken, state: State<AppState>) -> Result<(), String> {
    let pending = state.with_lock(|inner| {
        if inner.pending_prefetch.remove(&token.0) {
            tracing::debug!(target: "commands::cancel", token = %token.0, "cancelled prefetch");
        } else {
            tracing::debug!(target: "commands::cancel", token = %token.0, "cancel no-op");
        }
        Ok(inner.pending_prefetch.len())
    })?;

    state.stats().update_prefetch_pending(pending);
    Ok(())
}

#[tauri::command]
pub fn save_progress(source_id: SourceId, page: u32, state: State<AppState>) -> Result<(), String> {
    let core_page = state.with_lock(|inner| {
        if inner.sources.contains_key(&source_id.0) {
            tracing::info!(target: "commands::progress", source = %source_id.0, page, "progress saved");
            Ok(CorePageId { source_id: CoreSourceId::new(source_id.0.clone()), index: page })
        } else {
            Err("unknown source for progress".to_string())
        }
    })?;

    progress_store::save(&core_page).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn query_progress(source_id: SourceId, state: State<AppState>) -> Result<u32, String> {
    let core_source = state.with_lock(|inner| {
        if inner.sources.contains_key(&source_id.0) {
            Ok(CoreSourceId::new(source_id.0.clone()))
        } else {
            Err("unknown source for progress".to_string())
        }
    })?;

    let stored = progress_store::load(&core_source).map_err(|err| err.to_string())?;
    Ok(stored.map(|page| page.index).unwrap_or(0))
}

#[tauri::command]
pub fn stats(state: State<AppState>) -> Result<PerfStats, String> {
    let (active_sources, cached_pages) = state.with_lock(|inner| {
        Ok((inner.sources.len(), inner.sources.values().map(|src| src.pages.len()).sum::<usize>()))
    })?;

    let snapshot = state.stats().snapshot();

    Ok(PerfStats { snapshot, active_sources, cached_pages })
}

pub fn register<R: tauri::Runtime>(
    builder: tauri::Builder<R>,
    cache: Arc<ImageCache>,
    metrics: Arc<StatsCollector>,
) -> tauri::Builder<R> {
    builder.manage(AppState::new(cache, metrics)).invoke_handler(tauri::generate_handler![
        open_path,
        list_pages,
        get_page_url,
        get_thumb_url,
        prefetch,
        cancel,
        save_progress,
        query_progress,
        stats
    ])
}
