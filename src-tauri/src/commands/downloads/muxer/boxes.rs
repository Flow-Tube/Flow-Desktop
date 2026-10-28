//! Byte builders for ISO-BMFF boxes, shared by the MP4 writer and the tag block.

/// Appends big-endian fields to a payload.
#[derive(Default)]
pub(super) struct Payload(Vec<u8>);

impl Payload {
    pub(super) fn new() -> Self {
        Self::default()
    }

    pub(super) fn u8(&mut self, value: u8) -> &mut Self {
        self.0.push(value);
        self
    }

    pub(super) fn u16(&mut self, value: u16) -> &mut Self {
        self.0.extend_from_slice(&value.to_be_bytes());
        self
    }

    pub(super) fn u32(&mut self, value: u32) -> &mut Self {
        self.0.extend_from_slice(&value.to_be_bytes());
        self
    }

    pub(super) fn i32(&mut self, value: i32) -> &mut Self {
        self.0.extend_from_slice(&value.to_be_bytes());
        self
    }

    pub(super) fn u64(&mut self, value: u64) -> &mut Self {
        self.0.extend_from_slice(&value.to_be_bytes());
        self
    }

    pub(super) fn i64(&mut self, value: i64) -> &mut Self {
        self.0.extend_from_slice(&value.to_be_bytes());
        self
    }

    pub(super) fn bytes(&mut self, value: &[u8]) -> &mut Self {
        self.0.extend_from_slice(value);
        self
    }

    pub(super) fn zeros(&mut self, count: usize) -> &mut Self {
        self.0.resize(self.0.len() + count, 0);
        self
    }

    pub(super) fn finish(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.0)
    }
}

/// A plain box: 32-bit size, four-character type, payload.
pub(super) fn mp4_box(kind: &[u8], payload: &[u8]) -> Vec<u8> {
    debug_assert_eq!(kind.len(), 4, "box types are four bytes");
    let size = u32::try_from(8 + payload.len()).expect("a metadata box stays under 4 GiB");
    let mut out = Vec::with_capacity(8 + payload.len());
    out.extend_from_slice(&size.to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(payload);
    out
}

/// A box made of child boxes.
pub(super) fn container(kind: &[u8], children: &[Vec<u8>]) -> Vec<u8> {
    mp4_box(kind, &children.concat())
}

/// A `FullBox`: version and 24-bit flags ahead of the payload.
pub(super) fn full_box(kind: &[u8], version: u8, flags: u32, payload: &[u8]) -> Vec<u8> {
    let mut body = Vec::with_capacity(4 + payload.len());
    body.push(version);
    body.extend_from_slice(&flags.to_be_bytes()[1..]);
    body.extend_from_slice(payload);
    mp4_box(kind, &body)
}

#[cfg(test)]
mod tests {
    use super::{full_box, mp4_box};

    #[test]
    fn writes_size_type_and_payload() {
        assert_eq!(
            mp4_box(b"free", &[1, 2]),
            vec![0, 0, 0, 10, b'f', b'r', b'e', b'e', 1, 2]
        );
    }

    #[test]
    fn full_box_carries_version_and_flags() {
        assert_eq!(
            full_box(b"url ", 0, 1, &[]),
            vec![0, 0, 0, 12, b'u', b'r', b'l', b' ', 0, 0, 0, 1]
        );
    }
}
