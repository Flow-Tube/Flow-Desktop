//! The video codec family a format's mime type names, shared by the SABR selector and the
//! synthetic DASH manifest.

/// Ordered by how widely a family decodes, so sorting puts the safest first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum VideoCodecFamily {
    H264,
    Vp9,
    Av1,
    Other,
}

impl VideoCodecFamily {
    #[must_use]
    pub fn from_mime(mime_type: &str) -> Self {
        let mime = mime_type.to_ascii_lowercase();
        if mime.contains("avc1") || mime.contains("avc3") || mime.contains("h264") {
            Self::H264
        } else if mime.contains("vp9") || mime.contains("vp09") {
            Self::Vp9
        } else if mime.contains("av01") || mime.contains("av1") {
            Self::Av1
        } else {
            Self::Other
        }
    }

    #[must_use]
    pub const fn slug(self) -> &'static str {
        match self {
            Self::H264 => "h264",
            Self::Vp9 => "vp9",
            Self::Av1 => "av1",
            Self::Other => "other",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::VideoCodecFamily;

    #[test]
    fn names_each_family_from_a_youtube_mime_type() {
        for (mime, family) in [
            ("video/mp4; codecs=\"avc1.640028\"", VideoCodecFamily::H264),
            ("video/mp4; codecs=\"avc1.4D401F\"", VideoCodecFamily::H264),
            ("video/webm; codecs=\"vp9\"", VideoCodecFamily::Vp9),
            ("video/webm; codecs=\"vp9.2\"", VideoCodecFamily::Vp9),
            ("video/mp4; codecs=\"av01.0.12M.08\"", VideoCodecFamily::Av1),
            ("video/mp4; codecs=\"hvc1.1.6\"", VideoCodecFamily::Other),
        ] {
            assert_eq!(VideoCodecFamily::from_mime(mime), family, "{mime}");
        }
    }
}
