//! The `xtags` blob on adaptive audio formats: a base64url protobuf of repeated
//! `{1: key, 2: value}` string pairs. In practice the keys are `acont`
//! (`original`, `dubbed`, `dubbed-auto`), `drc` (`1` for the dynamic-range
//! compressed copy) and `lang`; they are the only signals separating a DRC copy
//! from its otherwise identical twin.

use std::collections::HashMap;

use base64::Engine;

use crate::streaming::sabr::pb::PbReader;

/// The key-value pairs of an `xtags` value, or none when it does not decode.
#[must_use]
pub fn decode_xtags(raw: &str) -> HashMap<String, String> {
    let normalized: String = raw
        .trim_end_matches('=')
        .chars()
        .map(|c| match c {
            '+' => '-',
            '/' => '_',
            other => other,
        })
        .collect();
    let Ok(bytes) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(normalized) else {
        return HashMap::new();
    };
    let mut tags = HashMap::new();
    let mut reader = PbReader::new(&bytes);
    while let Some(field) = reader.next_field() {
        if field.number != 1 || field.wire_type != 2 {
            continue;
        }
        let mut pair = PbReader::new(field.bytes);
        let (mut key, mut value) = (None, None);
        while let Some(part) = pair.next_field() {
            match part.number {
                1 => key = part.as_str().map(ToOwned::to_owned),
                2 => value = part.as_str().map(ToOwned::to_owned),
                _ => {}
            }
        }
        if let (Some(key), Some(value)) = (key, value) {
            tags.insert(key, value);
        }
    }
    tags
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::streaming::sabr::pb::PbWriter;

    fn encode(pairs: &[(&str, &str)]) -> String {
        let mut writer = PbWriter::new();
        for (key, value) in pairs {
            let mut pair = PbWriter::new();
            pair.write_string(1, key);
            pair.write_string(2, value);
            writer.write_message(1, pair.as_slice());
        }
        base64::engine::general_purpose::URL_SAFE.encode(writer.into_bytes())
    }

    #[test]
    fn reads_acont_drc_and_lang() {
        let tags = decode_xtags(&encode(&[
            ("acont", "dubbed-auto"),
            ("drc", "1"),
            ("lang", "es"),
        ]));
        assert_eq!(tags.get("acont").map(String::as_str), Some("dubbed-auto"));
        assert_eq!(tags.get("drc").map(String::as_str), Some("1"));
        assert_eq!(tags.get("lang").map(String::as_str), Some("es"));
    }

    #[test]
    fn garbage_decodes_to_nothing() {
        assert!(decode_xtags("!!!").is_empty());
        assert!(decode_xtags("").is_empty());
    }
}
