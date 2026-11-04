use bip39::Language::English;
use proptest::prelude::*;

use crate::sync2::recovery::{recovery_secret, recovery_words};

fn words(entropy: &[u8]) -> String {
    bip39::Mnemonic::from_entropy_in(English, entropy)
        .unwrap()
        .to_string()
}

proptest! {
    #[test]
    fn recovery_words_round_trip_in_any_case_and_spacing(secret: [u8; 32]) {
        let words = recovery_words(&secret).to_uppercase().replace(' ', " \n\t ");
        prop_assert_eq!(recovery_secret(&format!("  {words} ")), Some(secret));
    }

    #[test]
    fn valid_shorter_phrases_are_refused(
        entropy in prop_oneof![Just(16usize), Just(20), Just(24), Just(28)]
            .prop_flat_map(|n| prop::collection::vec(any::<u8>(), n)),
    ) {
        prop_assert_eq!(recovery_secret(&words(&entropy)), None);
    }

    #[test]
    fn any_list_of_words_is_refused_or_gives_a_secret(
        list in prop::collection::vec(prop::sample::select(&English.word_list()[..]), 1..30),
    ) {
        let _ = recovery_secret(&list.join(" "));
    }

    #[test]
    fn arbitrary_text_is_refused_without_panicking(text: String) {
        let _ = recovery_secret(&text);
    }
}
