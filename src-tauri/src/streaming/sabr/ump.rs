// UMP (Universal Media Protocol) parser for YouTube's SABR streaming protocol.

pub const ONESIE_HEADER: u32 = 10;
pub const ONESIE_DATA: u32 = 11;
pub const MEDIA_HEADER: u32 = 20;
pub const MEDIA: u32 = 21;
pub const MEDIA_END: u32 = 22;
pub const LIVE_METADATA: u32 = 31;
pub const NEXT_REQUEST_POLICY: u32 = 35;
pub const FORMAT_INITIALIZATION_METADATA: u32 = 42;
pub const SABR_REDIRECT: u32 = 43;
pub const SABR_ERROR: u32 = 44;
pub const SABR_SEEK: u32 = 45;
pub const RELOAD_PLAYER_RESPONSE: u32 = 46;
pub const PLAYBACK_START_POLICY: u32 = 47;
pub const ALLOWED_CACHED_FORMATS: u32 = 48;
pub const SELECTABLE_FORMATS: u32 = 51;
pub const REQUEST_IDENTIFIER: u32 = 52;
pub const REQUEST_CANCELLATION_POLICY: u32 = 53;
pub const SABR_CONTEXT_UPDATE: u32 = 57;
pub const STREAM_PROTECTION_STATUS: u32 = 58;
pub const SABR_CONTEXT_SENDING_POLICY: u32 = 59;
pub const SABR_ACK: u32 = 61;
pub const END_OF_TRACK: u32 = 62;
pub const SNACKBAR_MESSAGE: u32 = 67;

pub fn part_name(part_type: u32) -> &'static str {
    match part_type {
        ONESIE_HEADER => "ONESIE_HEADER",
        ONESIE_DATA => "ONESIE_DATA",
        MEDIA_HEADER => "MEDIA_HEADER",
        MEDIA => "MEDIA",
        MEDIA_END => "MEDIA_END",
        LIVE_METADATA => "LIVE_METADATA",
        NEXT_REQUEST_POLICY => "NEXT_REQUEST_POLICY",
        FORMAT_INITIALIZATION_METADATA => "FORMAT_INITIALIZATION_METADATA",
        SABR_REDIRECT => "SABR_REDIRECT",
        SABR_ERROR => "SABR_ERROR",
        SABR_SEEK => "SABR_SEEK",
        RELOAD_PLAYER_RESPONSE => "RELOAD_PLAYER_RESPONSE",
        PLAYBACK_START_POLICY => "PLAYBACK_START_POLICY",
        ALLOWED_CACHED_FORMATS => "ALLOWED_CACHED_FORMATS",
        SELECTABLE_FORMATS => "SELECTABLE_FORMATS",
        REQUEST_IDENTIFIER => "REQUEST_IDENTIFIER",
        REQUEST_CANCELLATION_POLICY => "REQUEST_CANCELLATION_POLICY",
        SABR_CONTEXT_UPDATE => "SABR_CONTEXT_UPDATE",
        STREAM_PROTECTION_STATUS => "STREAM_PROTECTION_STATUS",
        SABR_CONTEXT_SENDING_POLICY => "SABR_CONTEXT_SENDING_POLICY",
        SABR_ACK => "SABR_ACK",
        END_OF_TRACK => "END_OF_TRACK",
        SNACKBAR_MESSAGE => "SNACKBAR_MESSAGE",
        _ => "UNKNOWN",
    }
}

// ---------------------------------------------------------------------------
// Variable-length integer codec
// ---------------------------------------------------------------------------
pub fn read_varint(buf: &[u8]) -> Option<(u32, usize)> {
    let first = *buf.first()?;

    if first < 128 {
        Some((u32::from(first), 1))
    } else if first < 192 {
        let b1 = *buf.get(1)?;
        let value = (u32::from(first) & 0x3F) + 64 * u32::from(b1);
        Some((value, 2))
    } else if first < 224 {
        let b1 = *buf.get(1)?;
        let b2 = *buf.get(2)?;
        let value = (u32::from(first) & 0x1F) + 32 * (u32::from(b1) + 256 * u32::from(b2));
        Some((value, 3))
    } else if first < 240 {
        let b1 = *buf.get(1)?;
        let b2 = *buf.get(2)?;
        let b3 = *buf.get(3)?;
        let value = (u32::from(first) & 0x0F)
            + 16 * (u32::from(b1) + 256 * (u32::from(b2) + 256 * u32::from(b3)));
        Some((value, 4))
    } else {
        if buf.len() < 5 {
            return None;
        }
        let value = u32::from_le_bytes([buf[1], buf[2], buf[3], buf[4]]);
        Some((value, 5))
    }
}

// Encode a value as a YouTube-style UMP varint and append it to `out`.
#[cfg(test)]
pub fn write_varint(out: &mut Vec<u8>, value: u32) {
    // Each branch's threshold is the exclusive max the width can represent:
    //   2 bytes: (b0&0x3F)+64*b1            => < 64*256
    //   3 bytes: (b0&0x1F)+32*(b1+256*b2)   => < 32*256*256
    //   4 bytes: (b0&0x0F)+16*(...)         => < 16*256*256*256
    if value < 128 {
        out.push(value as u8);
    } else if value < 64 * 256 {
        let lo = value % 64;
        let hi = value / 64;
        out.push(128 | lo as u8);
        out.push(hi as u8);
    } else if value < 32 * 256 * 256 {
        let lo = value % 32;
        let rest = value / 32;
        let b1 = rest % 256;
        let b2 = rest / 256;
        out.push(192 | lo as u8);
        out.push(b1 as u8);
        out.push(b2 as u8);
    } else if value < 16 * 256 * 256 * 256 {
        let lo = value % 16;
        let rest = value / 16;
        let b1 = rest % 256;
        let rest = rest / 256;
        let b2 = rest % 256;
        let b3 = rest / 256;
        out.push(224 | lo as u8);
        out.push(b1 as u8);
        out.push(b2 as u8);
        out.push(b3 as u8);
    } else {
        out.push(240);
        out.extend_from_slice(&value.to_le_bytes());
    }
}

// ---------------------------------------------------------------------------
// UMP part
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct UmpPart {
    pub part_type: u32,
    pub data: Vec<u8>,
}

// ---------------------------------------------------------------------------
// Streaming parser
// ---------------------------------------------------------------------------
pub struct UmpParser {
    buffer: Vec<u8>,
}

impl Default for UmpParser {
    fn default() -> Self {
        Self::new()
    }
}

impl UmpParser {
    pub fn new() -> Self {
        Self { buffer: Vec::new() }
    }

    pub fn push(&mut self, data: &[u8]) {
        self.buffer.extend_from_slice(data);
    }

    pub fn next_part(&mut self) -> Option<UmpPart> {
        let buf = &self.buffer;

        let (part_type, type_len) = read_varint(buf)?;
        let (part_size, size_len) = read_varint(&buf[type_len..])?;

        let header_len = type_len + size_len;
        let total_len = header_len.checked_add(part_size as usize)?;

        if buf.len() < total_len {
            return None;
        }

        let data = buf[header_len..total_len].to_vec();
        self.buffer.drain(..total_len);
        Some(UmpPart { part_type, data })
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip(value: u32) {
        let mut buf = Vec::new();
        write_varint(&mut buf, value);
        let (decoded, consumed) = read_varint(&buf).expect("should decode");
        assert_eq!(decoded, value, "value mismatch for {value}");
        assert_eq!(consumed, buf.len(), "consumed length mismatch for {value}");
    }

    #[test]
    fn varint_all_widths() {
        for v in [
            0,
            1,
            127,
            128,
            16_383,
            16_384,
            2_097_151,
            2_097_152,
            268_435_455,
            268_435_456,
            u32::MAX,
        ] {
            roundtrip(v);
        }
    }

    #[test]
    fn read_varint_short_buffer() {
        assert!(read_varint(&[]).is_none());
        assert!(read_varint(&[0x80]).is_none());
        assert!(read_varint(&[0xF0, 0x01, 0x02]).is_none());
    }

    #[test]
    fn parser_single_part() {
        let mut out = Vec::new();
        write_varint(&mut out, MEDIA_HEADER);
        write_varint(&mut out, 4);
        out.extend_from_slice(&[0xDE, 0xAD, 0xBE, 0xEF]);

        let mut parser = UmpParser::new();
        parser.push(&out);

        let part = parser.next_part().expect("should yield a part");
        assert_eq!(part.part_type, MEDIA_HEADER);
        assert_eq!(part.data, vec![0xDE, 0xAD, 0xBE, 0xEF]);
        assert!(parser.next_part().is_none());
    }

    #[test]
    fn parser_multiple_parts_in_one_chunk() {
        let mut out = Vec::new();
        for i in 0..3 {
            write_varint(&mut out, MEDIA);
            write_varint(&mut out, 2);
            out.extend_from_slice(&[i, i + 10]);
        }
        let mut parser = UmpParser::new();
        parser.push(&out);
        for i in 0..3u8 {
            let part = parser.next_part().expect("should yield a part");
            assert_eq!(part.part_type, MEDIA);
            assert_eq!(part.data, vec![i, i + 10]);
        }
        assert!(parser.next_part().is_none());
    }

    #[test]
    fn parser_byte_at_a_time() {
        let mut out = Vec::new();
        write_varint(&mut out, SABR_ERROR);
        write_varint(&mut out, 4);
        out.extend_from_slice(&[1, 2, 3, 4]);

        let mut parser = UmpParser::new();
        for (i, &byte) in out.iter().enumerate() {
            assert!(
                parser.next_part().is_none(),
                "should not yield before all bytes present (byte {i})"
            );
            parser.push(&[byte]);
        }
        let part = parser.next_part().expect("should yield after all bytes");
        assert_eq!(part.part_type, SABR_ERROR);
        assert_eq!(part.data, vec![1, 2, 3, 4]);
    }

    #[test]
    fn parser_split_across_two_chunks_mid_body() {
        let body: Vec<u8> = (0..200u32).map(|i| (i % 256) as u8).collect();
        let mut out = Vec::new();
        write_varint(&mut out, MEDIA);
        write_varint(&mut out, body.len() as u32);
        out.extend_from_slice(&body);

        let mut parser = UmpParser::new();
        parser.push(&out[..10]);
        assert!(parser.next_part().is_none());
        parser.push(&out[10..]);
        let part = parser.next_part().expect("complete after second chunk");
        assert_eq!(part.part_type, MEDIA);
        assert_eq!(part.data, body);
    }

    #[test]
    fn parser_empty_body() {
        let mut out = Vec::new();
        write_varint(&mut out, MEDIA_END);
        write_varint(&mut out, 0);
        let mut parser = UmpParser::new();
        parser.push(&out);
        let part = parser.next_part().expect("should yield a part");
        assert_eq!(part.part_type, MEDIA_END);
        assert!(part.data.is_empty());
    }

    #[test]
    fn part_names() {
        assert_eq!(part_name(MEDIA), "MEDIA");
        assert_eq!(
            part_name(SABR_CONTEXT_SENDING_POLICY),
            "SABR_CONTEXT_SENDING_POLICY"
        );
        assert_eq!(part_name(9999), "UNKNOWN");
    }
}
