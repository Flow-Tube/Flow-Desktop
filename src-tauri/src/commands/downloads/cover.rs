//! The cover saved with a download: the sharpest image the CDNs offer, shaped the way
//! players show it (square for songs, 16:9 for videos), as a JPEG under 1 MB so it
//! fits in an MP4 `covr` atom. The same sizes and quality steps as the Android app.

use std::io::Cursor;
use std::time::Duration;

use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView};

use super::muxer::MAX_COVER_BYTES;
use super::tags::TagKind;

const SQUARE_MAX: u32 = 1200;
const LANDSCAPE_MAX: u32 = 1280;
const JPEG_QUALITIES: [u8; 2] = [90, 75];
/// `YouTube` answers a missing `maxresdefault` with a 120×90 grey placeholder.
const PLACEHOLDER_WIDTH: u32 = 120;
const FETCH_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CoverShape {
    Square,
    Landscape,
}

impl CoverShape {
    pub fn for_kind(kind: TagKind) -> Self {
        match kind {
            TagKind::Music => Self::Square,
            TagKind::Video | TagKind::Short => Self::Landscape,
        }
    }
}

/// Image URLs to try, sharpest first.
pub fn cover_candidates(
    shape: CoverShape,
    video_id: Option<&str>,
    thumbnail_url: Option<&str>,
) -> Vec<String> {
    let mut candidates = Vec::new();
    let thumbnail = thumbnail_url
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .map(|url| {
            url.strip_prefix("//")
                .map_or_else(|| url.to_string(), |rest| format!("https://{rest}"))
        });
    if let Some(url) = thumbnail.as_deref()
        && is_google_cdn(url)
        && let Some((base, _)) = url.split_once('=')
    {
        // `-p` lets the CDN scale past the stored size; it crops to the box asked for.
        candidates.push(match shape {
            CoverShape::Square => format!("{base}=w{SQUARE_MAX}-h{SQUARE_MAX}-p-l90-rj"),
            CoverShape::Landscape => format!("{base}=w{LANDSCAPE_MAX}-h720-p-l90-rj"),
        });
    }
    let id = video_id
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| thumbnail.as_deref().and_then(ytimg_video_id));
    if let Some(id) = id {
        for name in ["maxresdefault", "sddefault", "hq720", "hqdefault"] {
            candidates.push(format!("https://i.ytimg.com/vi/{id}/{name}.jpg"));
        }
    }
    if let Some(url) = thumbnail
        && !candidates.contains(&url)
    {
        candidates.push(url);
    }
    candidates
}

fn is_google_cdn(url: &str) -> bool {
    (url.contains("googleusercontent.com") || url.contains("ggpht.com")) && !url.contains("yt3.")
}

fn ytimg_video_id(url: &str) -> Option<String> {
    let rest = url
        .split("/vi/")
        .nth(1)
        .or_else(|| url.split("/vi_webp/").nth(1))?;
    let id = rest.split('/').next()?;
    (!id.is_empty()).then(|| id.to_string())
}

/// Fetches and shapes the cover, trying each candidate until one decodes.
pub async fn fetch_cover(
    shape: CoverShape,
    video_id: Option<&str>,
    thumbnail_url: Option<&str>,
) -> Result<Vec<u8>, String> {
    let mut last_error = "no cover image is available".to_string();
    for url in cover_candidates(shape, video_id, thumbnail_url) {
        match fetch_image(&url).await {
            Ok(bytes) => {
                match tokio::task::spawn_blocking(move || shape_cover(&bytes, shape)).await {
                    Ok(Ok(Some(jpeg))) => return Ok(jpeg),
                    Ok(Ok(None)) => last_error = format!("{url} is a placeholder"),
                    Ok(Err(error)) => last_error = error,
                    Err(error) => last_error = format!("cover task failed: {error}"),
                }
            }
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}

async fn fetch_image(url: &str) -> Result<Vec<u8>, String> {
    let response = crate::api::http::shared_client()
        .get(url)
        .timeout(FETCH_TIMEOUT)
        .send()
        .await
        .map_err(|error| format!("cover request failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("cover server returned {}", response.status()));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("could not read the cover: {error}"))?;
    if bytes.is_empty() {
        return Err("the cover was empty".to_string());
    }
    Ok(bytes.to_vec())
}

/// Crops and scales the image, then encodes it as a JPEG under 1 MB. `None` means the
/// image is `YouTube`'s "no thumbnail" placeholder.
pub fn shape_cover(bytes: &[u8], shape: CoverShape) -> Result<Option<Vec<u8>>, String> {
    let image = image::load_from_memory(bytes)
        .map_err(|error| format!("could not decode cover: {error}"))?;
    let (width, height) = image.dimensions();
    if width <= PLACEHOLDER_WIDTH {
        return Ok(None);
    }
    let shaped = match shape {
        CoverShape::Square => {
            let side = width.min(height);
            let cropped = image.crop_imm((width - side) / 2, (height - side) / 2, side, side);
            fit(cropped, SQUARE_MAX)
        }
        CoverShape::Landscape => fit(image, LANDSCAPE_MAX),
    };
    let rgb = DynamicImage::ImageRgb8(shaped.to_rgb8());
    for quality in JPEG_QUALITIES {
        let mut out = Cursor::new(Vec::new());
        let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality);
        rgb.write_with_encoder(encoder)
            .map_err(|error| format!("could not encode cover: {error}"))?;
        let jpeg = out.into_inner();
        if jpeg.len() <= MAX_COVER_BYTES {
            return Ok(Some(jpeg));
        }
    }
    Err("the cover is too large to embed".to_string())
}

/// Scales so the long edge is at most `max`; never upscales.
fn fit(image: DynamicImage, max: u32) -> DynamicImage {
    let (width, height) = image.dimensions();
    if width.max(height) <= max {
        image
    } else {
        image.resize(max, max, FilterType::Lanczos3)
    }
}

#[cfg(test)]
mod tests {
    use super::{CoverShape, cover_candidates, shape_cover};
    use image::{DynamicImage, GenericImageView, ImageFormat, RgbImage};
    use std::io::Cursor;

    fn png(width: u32, height: u32) -> Vec<u8> {
        let image = DynamicImage::ImageRgb8(RgbImage::from_fn(width, height, |x, y| {
            image::Rgb([
                u8::try_from(x % 256).unwrap_or(0),
                u8::try_from(y % 256).unwrap_or(0),
                128,
            ])
        }));
        let mut out = Cursor::new(Vec::new());
        image.write_to(&mut out, ImageFormat::Png).expect("png");
        out.into_inner()
    }

    #[test]
    fn music_prefers_a_square_cdn_crop_then_video_frames() {
        let candidates = cover_candidates(
            CoverShape::Square,
            Some("abc"),
            Some("https://lh3.googleusercontent.com/xyz=w120-h120-l90-rj"),
        );
        assert_eq!(
            candidates[0],
            "https://lh3.googleusercontent.com/xyz=w1200-h1200-p-l90-rj"
        );
        assert_eq!(
            candidates[1],
            "https://i.ytimg.com/vi/abc/maxresdefault.jpg"
        );
        assert_eq!(
            candidates.last().map(String::as_str),
            Some("https://lh3.googleusercontent.com/xyz=w120-h120-l90-rj")
        );
    }

    #[test]
    fn videos_walk_the_ytimg_ladder() {
        let candidates = cover_candidates(
            CoverShape::Landscape,
            None,
            Some("https://i.ytimg.com/vi/vid123/hqdefault.jpg?sqp=x"),
        );
        assert_eq!(
            candidates[0],
            "https://i.ytimg.com/vi/vid123/maxresdefault.jpg"
        );
        assert_eq!(candidates[1], "https://i.ytimg.com/vi/vid123/sddefault.jpg");
    }

    #[test]
    fn squares_are_centre_cropped_and_capped() {
        let jpeg = shape_cover(&png(1600, 900), CoverShape::Square)
            .expect("shapes")
            .expect("not a placeholder");
        assert_eq!(image::guess_format(&jpeg).ok(), Some(ImageFormat::Jpeg));
        let decoded = image::load_from_memory(&jpeg).expect("decodes");
        assert_eq!(decoded.dimensions(), (900, 900));
        let big = shape_cover(&png(2000, 2000), CoverShape::Square)
            .expect("shapes")
            .expect("not a placeholder");
        assert_eq!(
            image::load_from_memory(&big).expect("decodes").dimensions(),
            (1200, 1200)
        );
    }

    #[test]
    fn landscape_keeps_its_aspect_ratio() {
        let jpeg = shape_cover(&png(1920, 1080), CoverShape::Landscape)
            .expect("shapes")
            .expect("not a placeholder");
        let decoded = image::load_from_memory(&jpeg).expect("decodes");
        assert_eq!(decoded.dimensions(), (1280, 720));
        assert!(jpeg.len() <= 1_000_000);
    }

    #[test]
    fn rejects_the_placeholder() {
        assert_eq!(
            shape_cover(&png(120, 90), CoverShape::Landscape).expect("decodes"),
            None
        );
    }
}
