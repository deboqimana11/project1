//! High-quality image resizing utilities built on top of `fast_image_resize`.

use anyhow::{anyhow, ensure};
use fast_image_resize as fir;

use crate::codec::DecodedImage;
use crate::types::ImageDimensions;

use super::Result;

/// Filtering kernels supported by the resizer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResizeFilter {
    /// Fastest option, mostly useful for tests or diagnostic paths.
    Nearest,
    /// Box filter, behaves like area averaging when downscaling.
    Box,
    /// Bilinear interpolation.
    Bilinear,
    /// Hamming filter offering slightly sharper results than bilinear.
    Hamming,
    /// Catmull-Rom bicubic interpolation (aka Cubic Hermite spline).
    CatmullRom,
    /// Mitchell–Netravali bicubic interpolation.
    Mitchell,
    /// Lanczos3 filter (default) for high quality down/up scaling.
    Lanczos3,
}

impl Default for ResizeFilter {
    fn default() -> Self {
        Self::Lanczos3
    }
}

impl From<ResizeFilter> for fir::ResizeAlg {
    fn from(value: ResizeFilter) -> Self {
        use fir::FilterType;
        match value {
            ResizeFilter::Nearest => fir::ResizeAlg::Nearest,
            ResizeFilter::Box => fir::ResizeAlg::Convolution(FilterType::Box),
            ResizeFilter::Bilinear => fir::ResizeAlg::Convolution(FilterType::Bilinear),
            ResizeFilter::Hamming => fir::ResizeAlg::Convolution(FilterType::Hamming),
            ResizeFilter::CatmullRom => fir::ResizeAlg::Convolution(FilterType::CatmullRom),
            ResizeFilter::Mitchell => fir::ResizeAlg::Convolution(FilterType::Mitchell),
            ResizeFilter::Lanczos3 => fir::ResizeAlg::Convolution(FilterType::Lanczos3),
        }
    }
}

/// Controls how the resizer should process alpha channels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AlphaBehavior {
    /// Premultiply alpha before filtering (recommended default).
    Consider,
    /// Treat pixels as opaque RGB (skips pre/post multiply).
    Ignore,
}

impl Default for AlphaBehavior {
    fn default() -> Self {
        Self::Consider
    }
}

impl AlphaBehavior {
    fn into_bool(self) -> bool {
        matches!(self, AlphaBehavior::Consider)
    }
}

/// Settings passed to [`resize_rgba`].
#[derive(Debug, Clone, Copy)]
pub struct ResizeSettings {
    pub target: ImageDimensions,
    pub filter: ResizeFilter,
    pub alpha: AlphaBehavior,
}

impl ResizeSettings {
    pub fn new(target: ImageDimensions) -> Self {
        Self { target, filter: ResizeFilter::default(), alpha: AlphaBehavior::default() }
    }

    pub fn filter(mut self, filter: ResizeFilter) -> Self {
        self.filter = filter;
        self
    }

    pub fn alpha_behavior(mut self, alpha: AlphaBehavior) -> Self {
        self.alpha = alpha;
        self
    }
}

impl Default for ResizeSettings {
    fn default() -> Self {
        Self::new(ImageDimensions { width: 0, height: 0 })
    }
}

/// Result of a resize operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResizedImage {
    pub dimensions: ImageDimensions,
    pub pixels: Vec<u8>,
}

impl ResizedImage {
    /// Width in pixels of the resized image.
    pub fn width(&self) -> u32 {
        self.dimensions.width
    }

    /// Height in pixels of the resized image.
    pub fn height(&self) -> u32 {
        self.dimensions.height
    }

    /// Borrow the underlying RGBA8888 pixel buffer.
    pub fn pixels(&self) -> &[u8] {
        &self.pixels
    }

    /// Consume and convert into a [`DecodedImage`].
    pub fn into_decoded(self) -> DecodedImage {
        DecodedImage { dimensions: self.dimensions, pixels: self.pixels }
    }
}

/// Resize an RGBA8888 decoded frame using `fast_image_resize`.
pub fn resize_rgba(source: &DecodedImage, settings: ResizeSettings) -> Result<ResizedImage> {
    let src_width = source.width();
    let src_height = source.height();
    ensure!(src_width > 0 && src_height > 0, "source image has zero dimensions");

    let dst_width = settings.target.width;
    let dst_height = settings.target.height;
    ensure!(dst_width > 0 && dst_height > 0, "target dimensions must be non-zero");

    if src_width == dst_width && src_height == dst_height {
        return Ok(ResizedImage { dimensions: settings.target, pixels: source.pixels().to_vec() });
    }

    let src_pixels = source.pixels();
    ensure!(
        src_pixels.len() >= (src_width as usize * src_height as usize * 4),
        "source buffer is smaller than expected"
    );

    let src_view =
        fir::images::ImageRef::new(src_width, src_height, src_pixels, fir::PixelType::U8x4)
            .map_err(|err| anyhow!("failed to prepare source image: {err}"))?;

    let mut dst_image = fir::images::Image::new(dst_width, dst_height, fir::PixelType::U8x4);

    let options = fir::ResizeOptions::new()
        .resize_alg(settings.filter.into())
        .use_alpha(settings.alpha.into_bool());

    let mut resizer = fir::Resizer::new();
    resizer
        .resize(&src_view, &mut dst_image, Some(&options))
        .map_err(|err| anyhow!("fast image resize failed: {err}"))?;

    let pixels = dst_image.into_vec();

    Ok(ResizedImage { dimensions: settings.target, pixels })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::DecodedImage;
    use crate::types::ImageDimensions;

    fn sample_image(width: u32, height: u32) -> DecodedImage {
        let mut pixels = Vec::with_capacity((width * height * 4) as usize);
        let width_divisor = width.saturating_sub(1).max(1);
        let height_divisor = height.saturating_sub(1).max(1);
        for y in 0..height {
            for x in 0..width {
                let r = ((x * 255) / width_divisor).min(255) as u8;
                let g = ((y * 255) / height_divisor).min(255) as u8;
                pixels.extend_from_slice(&[r, g, 0, 255]);
            }
        }
        DecodedImage { dimensions: ImageDimensions { width, height }, pixels }
    }

    #[test]
    fn resizes_to_expected_dimensions() {
        let src = sample_image(4, 4);
        let target = ImageDimensions { width: 8, height: 8 };
        let resized = resize_rgba(&src, ResizeSettings::new(target)).expect("resize succeeds");
        assert_eq!(resized.width(), 8);
        assert_eq!(resized.height(), 8);
        assert_eq!(resized.pixels().len(), (8 * 8 * 4) as usize);
    }

    #[test]
    fn catmull_rom_downscale_preserves_gradient_shape() {
        let src = sample_image(8, 8);
        let target = ImageDimensions { width: 4, height: 4 };
        let resized =
            resize_rgba(&src, ResizeSettings::new(target).filter(ResizeFilter::CatmullRom))
                .expect("resize succeeds");

        // Ensure gradient ordering is preserved: top-left intensity should be less than bottom-right.
        let top_left = &resized.pixels()[0..4];
        let bottom_right_start = ((resized.pixels().len() / 4) - 1) * 4;
        let bottom_right = &resized.pixels()[bottom_right_start..bottom_right_start + 4];
        assert!(top_left[0] < bottom_right[0], "red channel should increase across gradient");
        assert!(top_left[1] < bottom_right[1], "green channel should increase across gradient");
    }

    #[test]
    fn nearest_neighbor_is_identity_for_same_dimensions() {
        let src = sample_image(5, 5);
        let settings = ResizeSettings::new(ImageDimensions { width: 5, height: 5 })
            .filter(ResizeFilter::Nearest);
        let resized = resize_rgba(&src, settings).expect("resize succeeds");
        assert_eq!(resized.pixels(), src.pixels());
    }
}
