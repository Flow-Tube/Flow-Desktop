//! The `vp09` sample entry for VP9 video taken out of `WebM`.
//!
//! `WebM` VP9 tracks usually carry no codec private data, so the `vpcC` fields come
//! from the RFC 6381 codecs string `YouTube` puts in the mime type
//! (`vp09.PP.LL.DD.CC.cp.tc.mc.FF`), falling back to the first key frame's header.

use super::boxes::{Payload, full_box, mp4_box};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Vp9Config {
    pub profile: u8,
    pub level: u8,
    pub bit_depth: u8,
    pub chroma_subsampling: u8,
    pub full_range: bool,
    pub colour_primaries: u8,
    pub transfer_characteristics: u8,
    pub matrix_coefficients: u8,
}

impl Default for Vp9Config {
    fn default() -> Self {
        // 8-bit 4:2:0 BT.709, the common case for YouTube SDR uploads.
        Self {
            profile: 0,
            level: 40,
            bit_depth: 8,
            chroma_subsampling: 1,
            full_range: false,
            colour_primaries: 1,
            transfer_characteristics: 1,
            matrix_coefficients: 1,
        }
    }
}

impl Vp9Config {
    /// Reads `vp09.PP.LL.DD[.CC.cp.tc.mc.FF]` out of a mime type, then fills what the
    /// string left out from the first key frame.
    pub(super) fn resolve(mime_type: &str, first_keyframe: Option<&[u8]>) -> Self {
        let mut config = Self::default();
        let from_header = first_keyframe.and_then(parse_keyframe_header);
        if let Some(header) = from_header {
            config.profile = header.profile;
            config.bit_depth = header.bit_depth;
            config.chroma_subsampling = header.chroma_subsampling;
            config.full_range = header.full_range;
        }
        let Some(codecs) = codecs_string(mime_type) else {
            return config;
        };
        let fields: Vec<u8> = codecs
            .split('.')
            .skip(1)
            .map_while(|field| field.parse::<u8>().ok())
            .collect();
        let field = |index: usize| fields.get(index).copied();
        if let Some(profile) = field(0) {
            config.profile = profile;
        }
        if let Some(level) = field(1) {
            config.level = level;
        }
        if let Some(depth) = field(2) {
            config.bit_depth = depth;
        }
        if let Some(subsampling) = field(3) {
            config.chroma_subsampling = subsampling;
        }
        if let Some(primaries) = field(4) {
            config.colour_primaries = primaries;
        }
        if let Some(transfer) = field(5) {
            config.transfer_characteristics = transfer;
        }
        if let Some(matrix) = field(6) {
            config.matrix_coefficients = matrix;
        }
        if let Some(range) = field(7) {
            config.full_range = range == 1;
        }
        config
    }
}

fn codecs_string(mime_type: &str) -> Option<&str> {
    let start = mime_type.find("vp09")?;
    let rest = &mime_type[start..];
    let end = rest.find(['"', ',', ';', ' ']).unwrap_or(rest.len());
    Some(&rest[..end])
}

struct KeyframeHeader {
    profile: u8,
    bit_depth: u8,
    chroma_subsampling: u8,
    full_range: bool,
}

struct Bits<'a> {
    data: &'a [u8],
    pos: usize,
}

impl Bits<'_> {
    fn bit(&mut self) -> Option<u8> {
        let byte = *self.data.get(self.pos / 8)?;
        let value = (byte >> (7 - self.pos % 8)) & 1;
        self.pos += 1;
        Some(value)
    }

    fn bits(&mut self, count: u32) -> Option<u32> {
        (0..count).try_fold(0_u32, |value, _| {
            Some((value << 1) | u32::from(self.bit()?))
        })
    }
}

/// The color config of a VP9 key frame's uncompressed header.
fn parse_keyframe_header(frame: &[u8]) -> Option<KeyframeHeader> {
    let mut bits = Bits {
        data: frame,
        pos: 0,
    };
    if bits.bits(2)? != 2 {
        return None;
    }
    let low = bits.bit()?;
    let high = bits.bit()?;
    let profile = (high << 1) | low;
    if profile == 3 {
        bits.bit()?;
    }
    if bits.bit()? == 1 {
        return None; // show_existing_frame
    }
    if bits.bit()? != 0 {
        return None; // not a key frame
    }
    bits.bits(2)?; // show_frame, error_resilient_mode
    if bits.bits(24)? != 0x49_83_42 {
        return None;
    }
    let bit_depth = if profile >= 2 {
        if bits.bit()? == 1 { 12 } else { 10 }
    } else {
        8
    };
    let color_space = bits.bits(3)?;
    let (full_range, subsampling) = if color_space == 7 {
        // sRGB is always full range and never subsampled.
        (true, (0, 0))
    } else {
        let range = bits.bit()? == 1;
        if profile == 1 || profile == 3 {
            (range, (bits.bit()?, bits.bit()?))
        } else {
            (range, (1, 1))
        }
    };
    let chroma_subsampling = match subsampling {
        (1, 1) => 1,
        (1, 0) => 2,
        _ => 3,
    };
    Some(KeyframeHeader {
        profile,
        bit_depth,
        chroma_subsampling,
        full_range,
    })
}

pub(super) fn vp09_sample_entry(width: u16, height: u16, config: Vp9Config) -> Vec<u8> {
    let mut vpcc = Payload::new();
    vpcc.u8(config.profile)
        .u8(config.level)
        .u8((config.bit_depth << 4)
            | (config.chroma_subsampling << 1)
            | u8::from(config.full_range))
        .u8(config.colour_primaries)
        .u8(config.transfer_characteristics)
        .u8(config.matrix_coefficients)
        .u16(0);
    let vpcc = full_box(b"vpcC", 1, 0, &vpcc.finish());
    let mut entry = visual_sample_entry_header(width, height);
    entry.extend(vpcc);
    mp4_box(b"vp09", &entry)
}

/// The 78-byte `VisualSampleEntry` body shared by every video sample entry.
pub(super) fn visual_sample_entry_header(width: u16, height: u16) -> Vec<u8> {
    let mut payload = Payload::new();
    payload
        .zeros(6)
        .u16(1) // data_reference_index
        .zeros(16)
        .u16(width)
        .u16(height)
        .u32(0x0048_0000)
        .u32(0x0048_0000)
        .u32(0)
        .u16(1) // frame_count
        .zeros(32) // compressorname
        .u16(0x0018)
        .u16(0xFFFF);
    payload.finish()
}

#[cfg(test)]
mod tests {
    use super::{Vp9Config, parse_keyframe_header, vp09_sample_entry};

    #[test]
    fn reads_the_full_codecs_string() {
        let config =
            Vp9Config::resolve(r#"video/webm; codecs="vp09.02.51.10.01.09.16.09.00""#, None);
        assert_eq!(config.profile, 2);
        assert_eq!(config.level, 51);
        assert_eq!(config.bit_depth, 10);
        assert_eq!(config.chroma_subsampling, 1);
        assert_eq!(config.colour_primaries, 9);
        assert_eq!(config.transfer_characteristics, 16);
        assert_eq!(config.matrix_coefficients, 9);
        assert!(!config.full_range);
    }

    #[test]
    fn short_strings_keep_bt709_defaults() {
        let config = Vp9Config::resolve(r#"video/webm; codecs="vp09.00.40.08""#, None);
        assert_eq!((config.profile, config.level, config.bit_depth), (0, 40, 8));
        assert_eq!(config.colour_primaries, 1);
    }

    #[test]
    fn parses_a_profile_0_key_frame_header() {
        // frame_marker 10, profile 00, show_existing 0, frame_type 0, show 1, err 0,
        // sync 0x498342, color_space 001 (BT.601), color_range 0.
        let mut bits = String::from("10");
        bits.push_str("00");
        bits.push_str("0010");
        bits.push_str("010010011000001101000010");
        bits.push_str("0010");
        while bits.len() % 8 != 0 {
            bits.push('0');
        }
        let bytes: Vec<u8> = bits
            .as_bytes()
            .chunks(8)
            .map(|chunk| u8::from_str_radix(std::str::from_utf8(chunk).unwrap(), 2).unwrap())
            .collect();
        let header = parse_keyframe_header(&bytes).expect("key frame");
        assert_eq!(header.profile, 0);
        assert_eq!(header.bit_depth, 8);
        assert_eq!(header.chroma_subsampling, 1);
        assert!(!header.full_range);
    }

    #[test]
    fn sample_entry_holds_a_version_1_vpcc() {
        let entry = vp09_sample_entry(1920, 1080, Vp9Config::default());
        assert_eq!(&entry[4..8], b"vp09");
        assert_eq!(&entry[8 + 24..8 + 28], &[0x07, 0x80, 0x04, 0x38]);
        let vpcc = 8 + 78;
        assert_eq!(&entry[vpcc + 4..vpcc + 8], b"vpcC");
        assert_eq!(entry[vpcc + 8], 1);
        assert_eq!(entry[vpcc + 14], (8 << 4) | (1 << 1));
    }
}
