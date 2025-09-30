//! File system access layer: folders, archives, and watchers.

pub mod archive;
pub mod folder;
mod util;

pub use archive::{list_archive_pages, load_archive};
pub use folder::{list_folder_pages, load_folder};
pub use util::{Token, is_hidden, is_supported_image, natural_cmp, natural_cmp_path, tokenize};

/// Shared result type for fs operations.
pub type Result<T> = crate::Result<T>;
