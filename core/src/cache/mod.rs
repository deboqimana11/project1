//! In-memory and disk cache coordination.

pub mod disk;
pub mod memory;

pub use memory::{CacheEntry, MemoryCache};

pub type Result<T> = crate::Result<T>;
