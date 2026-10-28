//! Profile photos: a 256 px centre-cropped square WebP at `profile_avatars/<id>.webp`, as on
//! Android. The `image` crate writes lossless WebP only, so the files are larger than Android's;
//! the format and path are the same.

use std::path::{Path, PathBuf};

use base64::Engine;
use image::ImageEncoder;
use image::imageops::FilterType;

use crate::errors::{AppError, AppResult};

pub const SIZE: u32 = 256;
/// Larger pictures are refused before decoding.
pub const MAX_INPUT_BYTES: u64 = 15 * 1024 * 1024;

pub fn path(app_data_dir: &Path, id: &str) -> PathBuf {
    app_data_dir
        .join("profile_avatars")
        .join(format!("{id}.webp"))
}

/// Centre-crops and scales any picture `image` can read to the avatar square.
pub fn encode(bytes: &[u8]) -> AppResult<Vec<u8>> {
    let picture = image::load_from_memory(bytes)
        .map_err(|_| AppError::ProfilePhotoInvalid("unreadable".into()))?;
    let square = picture
        .resize_to_fill(SIZE, SIZE, FilterType::Lanczos3)
        .to_rgba8();
    let mut webp = Vec::new();
    image::codecs::webp::WebPEncoder::new_lossless(&mut webp)
        .write_image(square.as_raw(), SIZE, SIZE, image::ExtendedColorType::Rgba8)
        .map_err(|error| AppError::ProfilePhotoInvalid(error.to_string()))?;
    Ok(webp)
}

pub fn save(app_data_dir: &Path, id: &str, webp: &[u8]) -> std::io::Result<()> {
    let target = path(app_data_dir, id);
    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let temp = target.with_extension("webp.tmp");
    std::fs::write(&temp, webp)?;
    std::fs::rename(temp, target)
}

/// The photo as a `data:` URL; the asset protocol isn't enabled.
pub fn data_url(app_data_dir: &Path, id: &str) -> Option<String> {
    let bytes = std::fs::read(path(app_data_dir, id)).ok()?;
    Some(format!(
        "data:image/webp;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

pub fn remove(app_data_dir: &Path, id: &str) -> std::io::Result<()> {
    match std::fs::remove_file(path(app_data_dir, id)) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn any_picture_becomes_a_256_square_webp() {
        let wide = image::RgbImage::from_pixel(640, 360, image::Rgb([200, 40, 40]));
        let mut png = Vec::new();
        image::DynamicImage::ImageRgb8(wide)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let webp = encode(&png).unwrap();
        let decoded = image::load_from_memory_with_format(&webp, image::ImageFormat::WebP).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (SIZE, SIZE));
    }

    #[test]
    fn something_that_is_not_a_picture_is_refused() {
        assert!(matches!(
            encode(b"not a picture"),
            Err(AppError::ProfilePhotoInvalid(_))
        ));
    }
}
