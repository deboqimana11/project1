//! Shared data structures exchanged between the core, Tauri shell, and UI layers.

use std::path::PathBuf;

/// Identifier for an opened source (folder, archive, etc.).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SourceId(String);

impl SourceId {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Page identifier combines the parent source with the page index.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PageId {
    pub source_id: SourceId,
    pub index: u32,
}

/// High level description of a source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Source {
    Folder { root: PathBuf, entries: Vec<PathBuf> },
    Archive { path: PathBuf, kind: ArchiveKind, entries: Vec<ArchiveEntry> },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ArchiveKind {
    Zip,
    Rar,
    SevenZip,
    Tar,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveEntry {
    pub path: PathBuf,
    pub size_bytes: u64,
    pub compressed: bool,
}

/// Metadata about an individual page, independent of rendering params.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageMeta {
    pub id: PageId,
    pub rel_path: PathBuf,
    pub width: u32,
    pub height: u32,
    pub is_double_spread: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FitMode {
    FitWidth,
    FitHeight,
    FitContain,
    Original,
    Fill,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RenderParams {
    pub fit: FitMode,
    pub viewport_w: u32,
    pub viewport_h: u32,
    pub scale: f32,
    pub rotation: i16,
    pub dpi: f32,
}

impl Default for RenderParams {
    fn default() -> Self {
        Self {
            fit: FitMode::FitContain,
            viewport_w: 1920,
            viewport_h: 1080,
            scale: 1.0,
            rotation: 0,
            dpi: 96.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ImageKey {
    pub cache_key: String,
}

impl ImageKey {
    pub fn new(cache_key: impl Into<String>) -> Self {
        Self { cache_key: cache_key.into() }
    }

    /// Derive a child key by appending a suffix separated with `::`.
    pub fn derive(&self, suffix: impl AsRef<str>) -> Self {
        let mut derived = self.cache_key.clone();
        derived.push_str("::");
        derived.push_str(suffix.as_ref());
        Self { cache_key: derived }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CacheBudget {
    pub bytes_max: usize,
}

impl Default for CacheBudget {
    fn default() -> Self {
        Self { bytes_max: 512 * 1024 * 1024 }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImageDimensions {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PrefetchPolicy {
    pub ahead: u32,
    pub behind: u32,
}

impl Default for PrefetchPolicy {
    fn default() -> Self {
        Self { ahead: 3, behind: 1 }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ActionId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct InputGesture(pub String);

/// Token identifying an in-flight asynchronous request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct RequestToken(u64);

impl RequestToken {
    pub(crate) fn new(value: u64) -> Self {
        Self(value)
    }

    pub fn as_u64(self) -> u64 {
        self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SeriesMeta {
    pub title: Option<String>,
    pub series: Option<String>,
    pub number: Option<String>,
    pub writer: Option<String>,
    pub publisher: Option<String>,
}

/// Container state for the running reader.
#[derive(Debug, Default)]
pub struct AppState {
    pub active_source: Option<SourceId>,
    pub current_page: Option<PageId>,
    pub cache_budget: CacheBudget,
}
