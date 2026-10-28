//! Minimal, self-contained Protocol Buffers (proto2/proto3 wire format) codec.
//!
//! YouTube's SABR protocol exchanges protobuf-encoded messages, but the only
//! messages we touch are a small, well-known set. Rather than depend on
//! `prost`/`prost-build` (which requires a `protoc` toolchain to be installed at
//! build time), we implement the handful of wire primitives we need directly.
//! This keeps the build hermetic and lets us do things `prost` makes awkward —
//! most importantly, capturing the *raw bytes* of an opaque sub-message (the
//! SABR playback cookie) so we can echo it back verbatim.
//!
//! Only the protobuf binary wire format is implemented (varint, 64-bit, 32-bit,
//! and length-delimited). That is all SABR uses.

pub mod wire {
    pub const VARINT: u8 = 0;
    pub const I64: u8 = 1;
    pub const LEN: u8 = 2;
    pub const I32: u8 = 5;
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

// Append-only protobuf message writer.
#[derive(Default)]
pub struct PbWriter {
    buf: Vec<u8>,
}

impl PbWriter {
    pub fn new() -> Self {
        Self { buf: Vec::new() }
    }

    pub fn into_bytes(self) -> Vec<u8> {
        self.buf
    }

    #[cfg(test)]
    pub fn as_slice(&self) -> &[u8] {
        &self.buf
    }

    // Encode a base-128 varint (LEB128, unsigned).
    pub fn write_raw_varint(&mut self, mut value: u64) {
        loop {
            let mut byte = (value & 0x7F) as u8;
            value >>= 7;
            if value != 0 {
                byte |= 0x80;
            }
            self.buf.push(byte);
            if value == 0 {
                break;
            }
        }
    }

    fn write_tag(&mut self, field: u32, wire_type: u8) {
        self.write_raw_varint(((field as u64) << 3) | wire_type as u64);
    }

    // `int32`/`int64`/`uint32`/`uint64`/`bool`/`enum` field (varint wire type).
    //
    // Negative `int32`/`int64` values are sign-extended to 64 bits exactly as
    // the reference encoders do (this matches `protoc` for non-`sint` types).
    pub fn write_varint_field(&mut self, field: u32, value: u64) {
        self.write_tag(field, wire::VARINT);
        self.write_raw_varint(value);
    }

    pub fn write_int64(&mut self, field: u32, value: i64) {
        self.write_varint_field(field, value as u64);
    }

    pub fn write_int32(&mut self, field: u32, value: i32) {
        // protobuf sign-extends negative int32 to 10 bytes.
        self.write_varint_field(field, i64::from(value) as u64);
    }

    pub fn write_uint64(&mut self, field: u32, value: u64) {
        self.write_varint_field(field, value);
    }

    pub fn write_bool(&mut self, field: u32, value: bool) {
        self.write_varint_field(field, u64::from(value));
    }

    pub fn write_float(&mut self, field: u32, value: f32) {
        self.write_tag(field, wire::I32);
        self.buf.extend_from_slice(&value.to_le_bytes());
    }

    pub fn write_bytes(&mut self, field: u32, value: &[u8]) {
        self.write_tag(field, wire::LEN);
        self.write_raw_varint(value.len() as u64);
        self.buf.extend_from_slice(value);
    }

    pub fn write_string(&mut self, field: u32, value: &str) {
        self.write_bytes(field, value.as_bytes());
    }

    // Write a nested message: its pre-encoded bytes as a length-delimited field.
    pub fn write_message(&mut self, field: u32, message: &[u8]) {
        self.write_bytes(field, message);
    }
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

// A single field encountered while iterating a message.
pub struct PbField<'a> {
    pub number: u32,
    pub wire_type: u8,
    // For LEN fields: the raw payload slice. For VARINT/I64/I32: empty.
    pub bytes: &'a [u8],
    // For VARINT fields: the decoded value. For I64/I32: the raw little-endian
    // integer reinterpreted as u64. For LEN: 0.
    pub varint: u64,
}

impl PbField<'_> {
    pub fn as_i64(&self) -> i64 {
        self.varint as i64
    }
    pub fn as_i32(&self) -> i32 {
        self.varint as i32
    }
    pub fn as_u64(&self) -> u64 {
        self.varint
    }
    pub fn as_u32(&self) -> u32 {
        self.varint as u32
    }
    pub fn as_bool(&self) -> bool {
        self.varint != 0
    }
    #[cfg(test)]
    pub fn as_f32(&self) -> f32 {
        f32::from_bits(self.varint as u32)
    }
    pub fn as_str(&self) -> Option<&str> {
        std::str::from_utf8(self.bytes).ok()
    }
    pub fn as_bytes(&self) -> &[u8] {
        self.bytes
    }
}

// Forward-only protobuf message reader. Tolerant of unknown fields and
// truncation: on malformed input the iterator simply ends.
pub struct PbReader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> PbReader<'a> {
    pub fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    fn read_raw_varint(&mut self) -> Option<u64> {
        let mut result: u64 = 0;
        let mut shift: u32 = 0;
        loop {
            if shift >= 64 {
                return None; // varint too long / corrupt
            }
            let byte = *self.data.get(self.pos)?;
            self.pos += 1;
            result |= u64::from(byte & 0x7F) << shift;
            if byte & 0x80 == 0 {
                return Some(result);
            }
            shift += 7;
        }
    }

    // Read the next base-128 varint from a packed-repeated payload. Returns
    // `None` at end of buffer. (Used to decode packed `repeated int32`.)
    pub fn read_packed_varint(&mut self) -> Option<u64> {
        if self.pos >= self.data.len() {
            return None;
        }
        self.read_raw_varint()
    }

    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let end = self.pos.checked_add(n)?;
        if end > self.data.len() {
            return None;
        }
        let slice = &self.data[self.pos..end];
        self.pos = end;
        Some(slice)
    }

    // Read the next field. Returns `None` at end-of-message or on corruption.
    pub fn next_field(&mut self) -> Option<PbField<'a>> {
        if self.pos >= self.data.len() {
            return None;
        }
        let key = self.read_raw_varint()?;
        let number = (key >> 3) as u32;
        let wire_type = (key & 0x07) as u8;
        if number == 0 {
            return None;
        }

        match wire_type {
            wire::VARINT => {
                let value = self.read_raw_varint()?;
                Some(PbField {
                    number,
                    wire_type,
                    bytes: &[],
                    varint: value,
                })
            }
            wire::I64 => {
                let raw = self.take(8)?;
                let value = u64::from_le_bytes(raw.try_into().ok()?);
                Some(PbField {
                    number,
                    wire_type,
                    bytes: &[],
                    varint: value,
                })
            }
            wire::I32 => {
                let raw = self.take(4)?;
                let value = u64::from(u32::from_le_bytes(raw.try_into().ok()?));
                Some(PbField {
                    number,
                    wire_type,
                    bytes: &[],
                    varint: value,
                })
            }
            wire::LEN => {
                let len = self.read_raw_varint()? as usize;
                let bytes = self.take(len)?;
                Some(PbField {
                    number,
                    wire_type,
                    bytes,
                    varint: 0,
                })
            }
            _ => None, // unknown / deprecated group wire types: stop parsing
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn varint_roundtrip() {
        for v in [0u64, 1, 127, 128, 300, 16_384, u32::MAX as u64, u64::MAX] {
            let mut w = PbWriter::new();
            w.write_raw_varint(v);
            let mut r = PbReader::new(w.as_slice());
            assert_eq!(r.read_raw_varint(), Some(v), "roundtrip {v}");
        }
    }

    #[test]
    fn scalar_fields_roundtrip() {
        let mut w = PbWriter::new();
        w.write_int32(1, -5);
        w.write_int64(2, 1_000_000);
        w.write_uint64(3, 42);
        w.write_bool(4, true);
        w.write_float(5, 1.5);
        w.write_string(6, "hello");
        w.write_bytes(7, &[0xDE, 0xAD]);
        let encoded = w.into_bytes();

        let mut r = PbReader::new(&encoded);
        let f = r.next_field().unwrap();
        assert_eq!(f.number, 1);
        assert_eq!(f.as_i32(), -5);
        let f = r.next_field().unwrap();
        assert_eq!(f.number, 2);
        assert_eq!(f.as_i64(), 1_000_000);
        let f = r.next_field().unwrap();
        assert_eq!(f.number, 3);
        assert_eq!(f.as_u64(), 42);
        let f = r.next_field().unwrap();
        assert_eq!(f.number, 4);
        assert!(f.as_bool());
        let f = r.next_field().unwrap();
        assert_eq!(f.number, 5);
        assert_eq!(f.as_f32(), 1.5);
        let f = r.next_field().unwrap();
        assert_eq!(f.number, 6);
        assert_eq!(f.as_str(), Some("hello"));
        let f = r.next_field().unwrap();
        assert_eq!(f.number, 7);
        assert_eq!(f.as_bytes(), &[0xDE, 0xAD]);
        assert!(r.next_field().is_none());
    }

    #[test]
    fn negative_int32_is_ten_bytes() {
        // protoc encodes negative int32 sign-extended to 64 bits (10 varint bytes).
        let mut w = PbWriter::new();
        w.write_int32(1, -1);
        let bytes = w.into_bytes();
        // tag (1 byte) + 10 varint bytes
        assert_eq!(bytes.len(), 11);
    }

    #[test]
    fn unknown_field_skipped_then_continue() {
        let mut w = PbWriter::new();
        w.write_string(3, "skip-me");
        w.write_int64(9, 7);
        let encoded = w.into_bytes();

        let mut r = PbReader::new(&encoded);
        // Caller iterates and ignores field 3, picks field 9.
        let mut found = None;
        while let Some(f) = r.next_field() {
            if f.number == 9 {
                found = Some(f.as_i64());
            }
        }
        assert_eq!(found, Some(7));
    }

    #[test]
    fn truncated_input_ends_cleanly() {
        let mut w = PbWriter::new();
        w.write_bytes(1, &[1, 2, 3, 4, 5]);
        let mut encoded = w.into_bytes();
        encoded.truncate(encoded.len() - 2); // chop the payload

        let mut r = PbReader::new(&encoded);
        assert!(r.next_field().is_none());
    }

    #[test]
    fn nested_message_roundtrip() {
        let mut inner = PbWriter::new();
        inner.write_int32(1, 251);
        inner.write_uint64(2, 1_700_000_000);
        let inner_bytes = inner.into_bytes();

        let mut outer = PbWriter::new();
        outer.write_message(2, &inner_bytes);
        let outer_bytes = outer.into_bytes();

        let mut r = PbReader::new(&outer_bytes);
        let f = r.next_field().unwrap();
        assert_eq!(f.number, 2);
        assert_eq!(f.wire_type, wire::LEN);
        let mut ir = PbReader::new(f.as_bytes());
        assert_eq!(ir.next_field().unwrap().as_i32(), 251);
        assert_eq!(ir.next_field().unwrap().as_u64(), 1_700_000_000);
    }
}
