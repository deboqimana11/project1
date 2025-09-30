//! Image decoding primitives and helpers.

use std::io::Cursor;
use std::path::Path;

use anyhow::{Context, anyhow};
use image::metadata::Orientation;
use image::{DynamicImage, ImageDecoder as _, ImageFormat, ImageReader, RgbaImage};
use moxcms::{CmsError, ColorProfile, Layout, TransformOptions};
use tracing::warn;

use crate::types::{ImageDimensions, PageMeta};

use super::Result;

/// RGBA pixel buffer returned by the primary image decoder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedImage {
    pub dimensions: ImageDimensions,
    pub pixels: Vec<u8>,
}

impl DecodedImage {
    /// Returns the width of the decoded image in pixels.
    pub fn width(&self) -> u32 {
        self.dimensions.width
    }

    /// Returns the height of the decoded image in pixels.
    pub fn height(&self) -> u32 {
        self.dimensions.height
    }

    /// Returns a reference to the raw RGBA8888 pixel buffer.
    pub fn pixels(&self) -> &[u8] {
        &self.pixels
    }
}

/// Decode the primary frame of a comic page into an RGBA buffer.
///
/// The decoder supports JPEG, PNG, WebP, and GIF (first frame). The input must be the raw
/// image bytes sourced from disk or an archive. The returned pixels are straight-alpha RGBA8888
/// data stored row-major from top-left to bottom-right.
pub fn decode_primary(meta: &PageMeta, data: &[u8]) -> Result<DecodedImage> {
    if data.is_empty() {
        return Err(anyhow!("empty image data for {:?}", meta.rel_path));
    }

    let reader = if let Some(format) = infer_format(&meta.rel_path) {
        ImageReader::with_format(Cursor::new(data), format)
    } else {
        ImageReader::new(Cursor::new(data))
            .with_guessed_format()
            .context("guessing image format")?
    };

    let mut decoder = reader
        .into_decoder()
        .with_context(|| format!("constructing decoder for image {:?}", meta.rel_path))?;

    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let icc_profile = decoder.icc_profile().unwrap_or(None);

    let mut image = DynamicImage::from_decoder(decoder)
        .with_context(|| format!("decoding image {:?}", meta.rel_path))?;

    apply_orientation(&mut image, orientation);

    let mut rgba = to_rgba(image);

    if let Some(profile) = icc_profile {
        if let Err(err) = convert_to_srgb_in_place(&mut rgba, &profile) {
            warn!(
                target: "codec::image",
                "failed to convert ICC profile for {:?}: {err}",
                meta.rel_path
            );
        }
    }

    let dimensions = ImageDimensions { width: rgba.width(), height: rgba.height() };
    let pixels = rgba.into_raw();

    Ok(DecodedImage { dimensions, pixels })
}

fn infer_format(path: &Path) -> Option<ImageFormat> {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .and_then(|ext| ImageFormat::from_extension(&ext))
}

fn to_rgba(image: DynamicImage) -> RgbaImage {
    // DynamicImage::into_rgba8 already performs color conversion when necessary.
    image.into_rgba8()
}

fn apply_orientation(image: &mut DynamicImage, orientation: Orientation) {
    if orientation != Orientation::NoTransforms {
        image.apply_orientation(orientation);
    }
}

fn convert_to_srgb_in_place(image: &mut RgbaImage, profile_bytes: &[u8]) -> Result<()> {
    let src_profile = ColorProfile::new_from_slice(profile_bytes)
        .map_err(|err| anyhow!("invalid ICC profile: {err}"))?;
    let dest_profile = ColorProfile::new_srgb();
    let (width, height) = image.dimensions();
    let raw = image.as_mut();

    match src_profile.create_transform_8bit(
        Layout::Rgba,
        &dest_profile,
        Layout::Rgba,
        TransformOptions::default(),
    ) {
        Ok(transform) => {
            let mut dst = vec![0u8; raw.len()];
            let raw_slice: &[u8] = &raw[..];
            transform
                .transform(raw_slice, &mut dst)
                .map_err(|err| anyhow!("icc transform failed: {err}"))?;
            raw.copy_from_slice(&dst);
            Ok(())
        }
        Err(CmsError::InvalidLayout) => {
            let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
            for px in raw.chunks_exact(4) {
                rgb.extend_from_slice(&px[..3]);
            }
            let mut dst_rgb = vec![0u8; rgb.len()];
            let transform = src_profile.create_transform_8bit(
                Layout::Rgb,
                &dest_profile,
                Layout::Rgb,
                TransformOptions::default(),
            )?;
            transform
                .transform(&rgb, &mut dst_rgb)
                .map_err(|err| anyhow!("icc transform failed: {err}"))?;
            for (rgba_px, rgb_px) in raw.chunks_exact_mut(4).zip(dst_rgb.chunks_exact(3)) {
                rgba_px[0..3].copy_from_slice(rgb_px);
            }
            Ok(())
        }
        Err(err) => Err(anyhow!("icc transform setup failed: {err}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{PageId, SourceId};
    use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
    use moxcms::{ColorProfile, RenderingIntent};

    fn stub_meta(name: &str) -> PageMeta {
        PageMeta {
            id: PageId { source_id: SourceId::new("test"), index: 0 },
            rel_path: name.into(),
            width: 0,
            height: 0,
            is_double_spread: false,
        }
    }

    fn sample_image() -> ImageBuffer<Rgba<u8>, Vec<u8>> {
        ImageBuffer::from_fn(2, 2, |x, y| match (x, y) {
            (0, 0) => Rgba([255, 0, 0, 255]),
            (1, 0) => Rgba([0, 255, 0, 255]),
            (0, 1) => Rgba([0, 0, 255, 255]),
            _ => Rgba([255, 255, 0, 255]),
        })
    }

    fn encode(image: &ImageBuffer<Rgba<u8>, Vec<u8>>, format: ImageFormat) -> Vec<u8> {
        let dynamic = DynamicImage::ImageRgba8(image.clone());
        let mut cursor = Cursor::new(Vec::new());
        dynamic.write_to(&mut cursor, format).expect("encode sample");
        cursor.into_inner()
    }

    #[test]
    fn apply_orientation_rotates_dimensions() {
        let mut image = DynamicImage::ImageRgba8(ImageBuffer::from_fn(2, 1, |x, _| match x {
            0 => Rgba([255, 0, 0, 255]),
            _ => Rgba([0, 255, 0, 255]),
        }));

        apply_orientation(&mut image, Orientation::Rotate90);

        assert_eq!(image.width(), 1);
        assert_eq!(image.height(), 2);

        let pixels = image.into_rgba8();
        let collected: Vec<[u8; 4]> = pixels.pixels().map(|px| px.0).collect();
        assert_eq!(collected[0], [255, 0, 0, 255]);
        assert_eq!(collected[1], [0, 255, 0, 255]);
    }

    #[test]
    fn decodes_png() {
        let image = sample_image();
        let bytes = encode(&image, ImageFormat::Png);
        let decoded = decode_primary(&stub_meta("page.png"), &bytes).expect("decode png");

        assert_eq!(decoded.dimensions, ImageDimensions { width: 2, height: 2 });
        assert_eq!(decoded.pixels.len(), 16);
        assert_eq!(&decoded.pixels[..4], &[255, 0, 0, 255]);
    }

    #[test]
    fn decodes_jpeg() {
        let image = sample_image();
        let bytes = encode(&image, ImageFormat::Jpeg);
        let decoded = decode_primary(&stub_meta("page.jpg"), &bytes).expect("decode jpeg");

        assert_eq!(decoded.dimensions, ImageDimensions { width: 2, height: 2 });
        assert_eq!(decoded.pixels.len(), 16);
    }

    #[test]
    fn decodes_webp() {
        let image = sample_image();
        let bytes = encode(&image, ImageFormat::WebP);
        let decoded = decode_primary(&stub_meta("page.webp"), &bytes).expect("decode webp");

        assert_eq!(decoded.dimensions, ImageDimensions { width: 2, height: 2 });
        assert_eq!(decoded.pixels.len(), 16);
    }

    #[test]
    fn decodes_gif_first_frame() {
        let image = sample_image();
        let bytes = encode(&image, ImageFormat::Gif);
        let decoded = decode_primary(&stub_meta("page.gif"), &bytes).expect("decode gif");

        assert_eq!(decoded.dimensions, ImageDimensions { width: 2, height: 2 });
        assert_eq!(decoded.pixels.len(), 16);
    }

    #[test]
    fn icc_conversion_preserves_alpha() {
        let mut image: RgbaImage = ImageBuffer::from_pixel(1, 1, Rgba([200, 100, 50, 128]));
        let mut profile = ColorProfile::new_display_p3();
        profile.rendering_intent = RenderingIntent::RelativeColorimetric;
        let icc_bytes = profile.encode().expect("encode profile");

        convert_to_srgb_in_place(&mut image, &icc_bytes).expect("icc conversion");

        let pixel = image.get_pixel(0, 0);
        assert_eq!(pixel[3], 128);
        assert_ne!(&pixel.0[..3], &[200, 100, 50]);
    }

    #[test]
    fn rejects_empty_input() {
        let err = decode_primary(&stub_meta("invalid.png"), &[]).unwrap_err();
        assert!(err.to_string().contains("empty image data"));
    }
}
