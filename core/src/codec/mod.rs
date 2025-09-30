//! Image decoding primitives and helpers.

pub mod image;

pub use image::{DecodedImage, decode_primary};

pub type Result<T> = crate::Result<T>;
