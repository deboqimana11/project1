use std::io::Cursor;

use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
use moxcms::{ColorProfile, RenderingIntent};
use reader_core::codec::decode_primary;
use reader_core::pipeline::resize::{AlphaBehavior, ResizeFilter, ResizeSettings, resize_rgba};
use reader_core::types::{ImageDimensions, PageId, PageMeta, SourceId};

fn stub_meta(name: &str) -> PageMeta {
    PageMeta {
        id: PageId { source_id: SourceId::new("tests"), index: 0 },
        rel_path: name.into(),
        width: 0,
        height: 0,
        is_double_spread: false,
    }
}

fn encode_sample(width: u32, height: u32, pixels: &[[u8; 4]]) -> Vec<u8> {
    let mut image = ImageBuffer::<Rgba<u8>, Vec<u8>>::new(width, height);
    for (i, pixel) in image.pixels_mut().enumerate() {
        pixel.0 = pixels[i];
    }
    let dynamic = DynamicImage::ImageRgba8(image);
    let mut buf = Cursor::new(Vec::new());
    dynamic.write_to(&mut buf, ImageFormat::Jpeg).expect("encode baseline jpeg");
    buf.into_inner()
}

fn inject_exif_and_icc(base: &[u8], orientation: u16, icc: Option<&[u8]>) -> Vec<u8> {
    assert!(base.starts_with(&[0xFF, 0xD8]));
    let mut output = Vec::with_capacity(base.len() + 128 + icc.map_or(0, |icc| icc.len()));
    output.extend_from_slice(&base[..2]); // SOI
    output.extend_from_slice(&build_exif_segment(orientation));
    if let Some(profile) = icc {
        output.extend_from_slice(&build_icc_segment(profile));
    }
    output.extend_from_slice(&base[2..]);
    output
}

fn build_exif_segment(orientation: u16) -> Vec<u8> {
    let mut payload = Vec::new();
    payload.extend_from_slice(b"Exif\0\0");
    payload.extend_from_slice(b"II*\0");
    payload.extend_from_slice(&8u32.to_le_bytes());
    payload.extend_from_slice(&1u16.to_le_bytes());
    payload.extend_from_slice(&0x0112u16.to_le_bytes());
    payload.extend_from_slice(&3u16.to_le_bytes()); // SHORT
    payload.extend_from_slice(&1u32.to_le_bytes());
    let mut value = orientation.to_le_bytes().to_vec();
    value.extend_from_slice(&[0, 0]);
    payload.extend_from_slice(&value);
    payload.extend_from_slice(&0u32.to_le_bytes());

    let length = (payload.len() + 2) as u16;
    let mut segment = Vec::with_capacity(2 + payload.len());
    segment.extend_from_slice(&[0xFF, 0xE1]);
    segment.extend_from_slice(&length.to_be_bytes());
    segment.extend_from_slice(&payload);
    segment
}

fn build_icc_segment(icc: &[u8]) -> Vec<u8> {
    let mut payload = Vec::new();
    payload.extend_from_slice(b"ICC_PROFILE\0");
    payload.push(1); // sequence number
    payload.push(1); // total chunks
    payload.extend_from_slice(icc);

    let length = (payload.len() + 2) as u16;
    let mut segment = Vec::with_capacity(2 + payload.len());
    segment.extend_from_slice(&[0xFF, 0xE2]);
    segment.extend_from_slice(&length.to_be_bytes());
    segment.extend_from_slice(&payload);
    segment
}

#[test]
fn decode_applies_orientation_and_icc_conversion() {
    let base = encode_sample(2, 1, &[[200, 80, 40, 255], [40, 160, 220, 255]]);
    let orientation_only = inject_exif_and_icc(&base, 6, None);

    let mut profile = ColorProfile::new_display_p3();
    profile.rendering_intent = RenderingIntent::RelativeColorimetric;
    let icc_bytes = profile.encode().expect("encode icc");
    let orientation_and_icc = inject_exif_and_icc(&base, 6, Some(&icc_bytes));

    let decoded_plain = decode_primary(&stub_meta("plain.jpg"), &base).expect("decode");
    let decoded_oriented =
        decode_primary(&stub_meta("oriented.jpg"), &orientation_only).expect("decode oriented");
    let decoded_icc =
        decode_primary(&stub_meta("icc.jpg"), &orientation_and_icc).expect("decode icc");

    assert_eq!(decoded_plain.dimensions, ImageDimensions { width: 2, height: 1 });
    assert_eq!(decoded_oriented.dimensions, ImageDimensions { width: 1, height: 2 });
    assert_eq!(decoded_icc.dimensions, decoded_oriented.dimensions);

    let plain_first = &decoded_plain.pixels()[0..3];
    let oriented_top = &decoded_oriented.pixels()[0..3];
    let icc_top = &decoded_icc.pixels()[0..3];
    // Orientation should preserve the original first pixel's colour (aside from JPEG loss).
    for (o, p) in oriented_top.iter().zip(plain_first.iter()) {
        assert!((*o as i16 - *p as i16).abs() <= 5);
    }
    assert_ne!(oriented_top, icc_top, "ICC conversion should adjust colour channels");
}

#[test]
fn resize_errors_on_zero_dimension() {
    use reader_core::codec::DecodedImage;

    let image =
        DecodedImage { dimensions: ImageDimensions { width: 2, height: 2 }, pixels: vec![255; 16] };
    let settings = ResizeSettings::new(ImageDimensions { width: 0, height: 2 })
        .filter(ResizeFilter::Nearest)
        .alpha_behavior(AlphaBehavior::Ignore);
    let err = resize_rgba(&image, settings).expect_err("zero width must fail");
    assert!(err.to_string().contains("target dimensions"));
}
