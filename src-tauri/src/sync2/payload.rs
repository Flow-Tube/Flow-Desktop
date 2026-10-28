use std::io::Read;

use flate2::Compression;
use flate2::read::GzDecoder;
use flate2::read::GzEncoder;

use super::{Error, Result};

const MIN_SIZE: usize = 256;
const MAX_INFLATED: u64 = 64 * 1024 * 1024;

/// PADMÉ with a 256-byte floor.
pub fn padded_size(n: usize) -> usize {
    if n <= MIN_SIZE {
        return MIN_SIZE;
    }
    let e = n.ilog2();
    let s = e.ilog2() + 1;
    let mask = (1usize << (e - s)) - 1;
    (n + mask) & !mask
}

pub fn encode_payload(content: &[u8]) -> Result<Vec<u8>> {
    let mut body = Vec::new();
    GzEncoder::new(content, Compression::best())
        .read_to_end(&mut body)
        .map_err(|_| Error::Payload)?;
    let length = u32::try_from(body.len()).map_err(|_| Error::Length)?;
    let mut payload = length.to_be_bytes().to_vec();
    payload.extend_from_slice(&body);
    payload.resize(padded_size(payload.len()), 0);
    Ok(payload)
}

pub fn decode_payload(payload: &[u8]) -> Result<Vec<u8>> {
    let (length, rest) = payload.split_first_chunk::<4>().ok_or(Error::Payload)?;
    let length = u32::from_be_bytes(*length) as usize;
    if length > rest.len() || rest[length..].iter().any(|&b| b != 0) {
        return Err(Error::Payload);
    }
    let mut content = Vec::new();
    GzDecoder::new(&rest[..length])
        .take(MAX_INFLATED + 1)
        .read_to_end(&mut content)
        .map_err(|_| Error::Payload)?;
    if content.len() as u64 > MAX_INFLATED {
        return Err(Error::Payload);
    }
    Ok(content)
}
