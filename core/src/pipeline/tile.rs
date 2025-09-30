//! Slice extremely tall pages into smaller vertical tiles for efficient rendering.

use crate::codec::DecodedImage;
use crate::types::{ImageDimensions, ImageKey};

use super::Result;

/// Configuration for long vertical image tiling.
#[derive(Debug, Clone, Copy)]
pub struct TileConfig {
    /// Only images with `height / width` greater than or equal to this trigger tiling.
    pub aspect_ratio_threshold: f32,
    /// Maximum height, in pixels, for each tile before overlap is applied.
    pub max_tile_height: u32,
    /// Number of overlapping rows shared between adjacent tiles to avoid seams.
    pub overlap: u32,
}

impl Default for TileConfig {
    fn default() -> Self {
        Self { aspect_ratio_threshold: 4.0, max_tile_height: 2048, overlap: 128 }
    }
}

/// Metadata for a generated tile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TileSlice {
    pub index: u32,
    pub key: ImageKey,
    pub offset_y: u32,
    pub image: DecodedImage,
}

/// Produce vertical tiles for tall images, returning an empty vector if tiling is unnecessary.
pub fn slice_vertical(
    source: &DecodedImage,
    base_key: &ImageKey,
    config: TileConfig,
) -> Result<Vec<TileSlice>> {
    if source.width() == 0 || source.height() == 0 {
        return Ok(Vec::new());
    }

    let aspect_ratio = source.height() as f32 / source.width() as f32;
    if aspect_ratio < config.aspect_ratio_threshold || source.height() <= config.max_tile_height {
        return Ok(Vec::new());
    }

    let stride = (source.width() as usize) * 4;
    let mut tiles = Vec::new();
    let mut index = 0u32;

    let overlap = config.overlap.min(config.max_tile_height.saturating_sub(1));
    let step = config.max_tile_height.saturating_sub(overlap).max(1);

    let mut start_row = 0u32;
    while start_row < source.height() {
        let mut end_row = start_row.saturating_add(config.max_tile_height);
        if end_row > source.height() {
            end_row = source.height();
        }

        let tile_height = end_row - start_row;
        let mut pixels = Vec::with_capacity((tile_height as usize) * stride);
        let start_byte = (start_row as usize) * stride;
        let end_byte = (end_row as usize) * stride;
        pixels.extend_from_slice(&source.pixels()[start_byte..end_byte]);

        let key = base_key.derive(format!("tile{index}"));
        let image = DecodedImage {
            dimensions: ImageDimensions { width: source.width(), height: tile_height },
            pixels,
        };
        tiles.push(TileSlice { index, key, offset_y: start_row, image });

        index += 1;
        if end_row == source.height() {
            break;
        }
        start_row = start_row.saturating_add(step);
    }

    Ok(tiles)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tall_image(width: u32, height: u32, value: u8) -> DecodedImage {
        let pixels = vec![value; (width * height * 4) as usize];
        DecodedImage { dimensions: ImageDimensions { width, height }, pixels }
    }

    #[test]
    fn returns_empty_when_not_tall_enough() {
        let image = tall_image(1024, 2048, 10);
        let key = ImageKey::new("page::1");
        let tiles = slice_vertical(&image, &key, TileConfig::default()).unwrap();
        assert!(tiles.is_empty());
    }

    #[test]
    fn slices_long_image_into_overlapping_tiles() {
        let image = tall_image(512, 4096, 42);
        let key = ImageKey::new("page::webtoon");
        let config = TileConfig::default();
        let tiles = slice_vertical(&image, &key, config).unwrap();

        assert!(tiles.len() >= 2);
        assert_eq!(tiles[0].offset_y, 0);
        assert_eq!(tiles[0].image.dimensions.width, 512);
        assert_eq!(tiles[0].image.dimensions.height, config.max_tile_height);

        let step = config.max_tile_height - config.overlap;
        assert_eq!(tiles[1].offset_y, step);
        assert!(tiles.last().unwrap().image.dimensions.height <= config.max_tile_height);
        assert!(tiles.last().unwrap().offset_y < image.height());
    }

    #[test]
    fn ensures_last_tile_reaches_bottom() {
        let image = tall_image(400, 5000, 99);
        let key = ImageKey::new("page::long");
        let tiles = slice_vertical(&image, &key, TileConfig::default()).unwrap();
        let last = tiles.last().unwrap();
        assert_eq!(last.offset_y + last.image.dimensions.height, image.height());
    }

    #[test]
    fn derives_unique_keys_per_tile() {
        let image = tall_image(300, 3000, 55);
        let key = ImageKey::new("page::unique");
        let tiles = slice_vertical(&image, &key, TileConfig::default()).unwrap();
        let mut unique = std::collections::HashSet::new();
        for tile in tiles {
            assert!(unique.insert(tile.key.cache_key));
        }
    }
}
