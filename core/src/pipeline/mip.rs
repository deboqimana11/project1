//! Generate RGBA mipmap chains for decoded pages.

use crate::codec::DecodedImage;
use crate::pipeline::resize::{
    AlphaBehavior, ResizeFilter, ResizeSettings, ResizedImage, resize_rgba,
};
use crate::types::{ImageDimensions, ImageKey};

use super::Result;

/// Controls how mip levels are produced.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MipChainConfig {
    /// Smallest width or height a generated level may have before stopping.
    pub min_dimension: u32,
    /// Filter used for each downscale step.
    pub filter: ResizeFilter,
    /// Whether to premultiply alpha during resampling.
    pub alpha: AlphaBehavior,
}

impl Default for MipChainConfig {
    fn default() -> Self {
        Self { min_dimension: 1, filter: ResizeFilter::Lanczos3, alpha: AlphaBehavior::Consider }
    }
}

/// Single mip level derived from the base image.
#[derive(Debug, Clone)]
pub struct MipLevel {
    pub level: u32,
    pub key: ImageKey,
    pub dimensions: ImageDimensions,
    pub image: ResizedImage,
}

/// Collection of mip levels, excluding level 0 (original image).
#[derive(Debug, Clone)]
pub struct MipChain {
    base_key: ImageKey,
    levels: Vec<MipLevel>,
}

impl MipChain {
    pub fn new(base_key: ImageKey, levels: Vec<MipLevel>) -> Self {
        Self { base_key, levels }
    }

    pub fn base_key(&self) -> &ImageKey {
        &self.base_key
    }

    pub fn levels(&self) -> &[MipLevel] {
        &self.levels
    }

    pub fn into_levels(self) -> Vec<MipLevel> {
        self.levels
    }

    pub fn len(&self) -> usize {
        self.levels.len()
    }

    pub fn is_empty(&self) -> bool {
        self.levels.is_empty()
    }
}

/// Generate a mip chain by iteratively downscaling the image by factors of two.
pub fn build_chain(
    base_key: &ImageKey,
    source: &DecodedImage,
    config: MipChainConfig,
) -> Result<MipChain> {
    let mut levels = Vec::new();
    let mut current =
        DecodedImage { dimensions: source.dimensions, pixels: source.pixels().to_vec() };
    let mut level_index = 1u32;

    loop {
        let next_width = next_dimension(current.width(), config.min_dimension);
        let next_height = next_dimension(current.height(), config.min_dimension);

        if next_width == current.width() && next_height == current.height() {
            break;
        }

        let target = ImageDimensions { width: next_width, height: next_height };
        let settings =
            ResizeSettings::new(target).filter(config.filter).alpha_behavior(config.alpha);

        let resized = resize_rgba(&current, settings)?;
        let key = base_key.derive(format!("mip{level_index}"));

        levels.push(MipLevel {
            level: level_index,
            key,
            dimensions: target,
            image: resized.clone(),
        });

        current = resized.into_decoded();
        level_index += 1;

        if target.width == config.min_dimension && target.height == config.min_dimension {
            break;
        }

        if target.width == 1 && target.height == 1 {
            break;
        }
    }

    Ok(MipChain::new(base_key.clone(), levels))
}

fn next_dimension(current: u32, min_dimension: u32) -> u32 {
    let halved = (current.max(1) + 1) / 2;
    let next = halved.max(min_dimension); // respect minimum size
    next.min(current)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source_image(width: u32, height: u32) -> DecodedImage {
        let mut pixels = Vec::with_capacity((width * height * 4) as usize);
        for _ in 0..(width * height) {
            pixels.extend_from_slice(&[64, 128, 192, 255]);
        }
        DecodedImage { dimensions: ImageDimensions { width, height }, pixels }
    }

    #[test]
    fn generates_expected_number_of_levels() {
        let base_key = ImageKey::new("source::base");
        let source = source_image(16, 8);
        let chain = build_chain(&base_key, &source, MipChainConfig::default()).expect("chain");
        let dims: Vec<(u32, u32)> = chain
            .levels()
            .iter()
            .map(|lvl| (lvl.dimensions.width, lvl.dimensions.height))
            .collect();
        assert_eq!(dims, vec![(8, 4), (4, 2), (2, 1), (1, 1)]);
        assert_eq!(chain.len(), 4);
    }

    #[test]
    fn respects_custom_min_dimension() {
        let base_key = ImageKey::new("source::base");
        let source = source_image(40, 20);
        let config = MipChainConfig { min_dimension: 8, ..Default::default() };
        let chain = build_chain(&base_key, &source, config).expect("chain");
        let dims: Vec<(u32, u32)> = chain
            .levels()
            .iter()
            .map(|lvl| (lvl.dimensions.width, lvl.dimensions.height))
            .collect();
        assert_eq!(dims, vec![(20, 10), (10, 8), (8, 8)]);
        let tail = chain.levels().last().unwrap();
        assert_eq!(tail.dimensions.width, 8);
        assert_eq!(tail.dimensions.height, 8);
    }

    #[test]
    fn derives_stable_keys_per_level() {
        let base_key = ImageKey::new("page::123");
        let source = source_image(8, 8);
        let chain = build_chain(&base_key, &source, MipChainConfig::default()).expect("chain");
        let keys: Vec<_> = chain.levels().iter().map(|lvl| lvl.key.cache_key.clone()).collect();
        assert_eq!(keys, vec!["page::123::mip1", "page::123::mip2", "page::123::mip3",]);
    }
}
