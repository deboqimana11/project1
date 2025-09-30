//! Core library scaffold for the local comic reader.

#![deny(missing_debug_implementations)]

pub mod cache;
pub mod codec;
pub mod fs;
pub mod keymap;
pub mod log;
pub mod meta;
pub mod pipeline;
pub mod stats;
pub mod store;
pub mod types;

pub type Result<T> = std::result::Result<T, anyhow::Error>;

pub use types::{
    ActionId, AppState, ArchiveEntry, ArchiveKind, CacheBudget, FitMode, ImageDimensions, ImageKey,
    InputGesture, PageId, PageMeta, PrefetchPolicy, RenderParams, SeriesMeta, Source, SourceId,
};

/// Returns the version of the core crate for telemetry and debugging.
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposes_semver_version() {
        assert!(version().contains('.'));
    }

    #[test]
    fn constructs_basic_types() {
        let source_id = SourceId::new("demo");
        let page = PageId { source_id: source_id.clone(), index: 0 };
        let meta = PageMeta {
            id: page,
            rel_path: std::path::PathBuf::from("0001.png"),
            width: 0,
            height: 0,
            is_double_spread: false,
        };

        assert_eq!(meta.id.source_id, source_id);
    }
}
