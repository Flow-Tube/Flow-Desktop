use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use proptest::prelude::*;

use super::mutations;
use crate::sync::canonical::to_canonical_json;
use crate::sync2::codes::{QrCode, StoreLocation, new_offer, read_code};
use crate::sync2::pairing::pairing_commit;
use crate::sync2::pipe::LanAddress;

fn base64_or_text() -> impl Strategy<Value = String> {
    prop_oneof![
        prop::collection::vec(any::<u8>(), 0..40).prop_map(|b| URL_SAFE_NO_PAD.encode(b)),
        any::<String>(),
    ]
}

fn qr_code() -> impl Strategy<Value = QrCode> {
    let kind = prop_oneof![Just("server"), Just("webdav"), Just("lan"), Just("other")];
    let store = (kind, proptest::option::of(any::<String>()))
        .prop_map(|(k, u)| StoreLocation { k: k.to_owned(), u });
    let address = (any::<String>(), any::<u16>()).prop_map(|(a, p)| LanAddress { a, p });
    (
        prop_oneof![Just(2u8), any::<u8>()],
        base64_or_text(),
        base64_or_text(),
        prop_oneof![Just("m".to_owned()), Just("n".to_owned()), any::<String>()],
        any::<String>(),
        proptest::option::of(store),
        proptest::option::of(prop::collection::vec(address, 0..3)),
    )
        .prop_map(|(v, t, c, r, d, s, l)| QrCode {
            v,
            t,
            c,
            r,
            d,
            s,
            l,
        })
}

proptest! {
    #[test]
    fn arbitrary_text_is_read_without_panicking(text: String) {
        let _ = read_code(&text);
    }

    #[test]
    fn a_code_read_is_the_code_written(qr in qr_code()) {
        let text = String::from_utf8(to_canonical_json(&qr)).unwrap();
        if let Ok(code) = read_code(&text) {
            prop_assert_eq!(code.qr(), &qr);
            let token = URL_SAFE_NO_PAD.decode(&qr.t).ok().filter(|t| t.len() == 16);
            prop_assert_eq!(code.token().ok().map(Vec::from), token);
            let commitment = URL_SAFE_NO_PAD.decode(&qr.c).ok().filter(|k| k.len() == 32);
            prop_assert_eq!(code.commitment().ok().map(Vec::from), commitment);
        }
    }

    #[test]
    fn a_changed_member_code_is_read_without_panicking(
        changed in mutations(new_offer(Some(StoreLocation::lan()), "Desk", None).qr.into_bytes()),
    ) {
        let _ = read_code(&String::from_utf8_lossy(&changed));
    }
}

#[test]
fn a_member_code_reads_back() {
    let store = StoreLocation::webdav("https://dav.example/flow");
    let offer = new_offer(Some(store.clone()), "Desk", None);
    let code = read_code(&offer.qr).unwrap();
    assert_eq!(code.token().unwrap(), offer.token);
    assert_eq!(code.commitment().unwrap(), pairing_commit(&offer.public));
    assert!(matches!(code, crate::sync2::codes::Code::Member { store: s, .. } if s == store));
}
