//! Key spec 3 against Flow for Android: its golden cases (`fixtures/neuro/key_spec_golden.json`,
//! byte-identical to Android's) and ports of `NeuroKeySpecTest`, `BrainKeyRekeyTest`'s key
//! function and `NeuroPhraseLearningTest`'s phrase test.

use std::collections::HashMap;

use flow_desktop_lib::flow_neuro::keyspec::phrases::{IdfSnapshot, is_phrase};
use flow_desktop_lib::flow_neuro::keyspec::{KeySpec, VERSION};
use serde_json::Value;

const GOLDEN: &str = include_str!("fixtures/neuro/key_spec_golden.json");

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .expect("an array")
        .iter()
        .map(|item| item.as_str().expect("a string").to_string())
        .collect()
}

#[test]
fn every_golden_case_reads_as_the_spec_says() {
    let golden: Value = serde_json::from_str(GOLDEN).unwrap();
    assert_eq!(golden["keySpec"].as_u64(), Some(u64::from(VERSION)));
    let cases = golden["cases"].as_array().unwrap();
    assert!(cases.len() >= 60);

    let mut failures = Vec::new();
    for case in cases {
        let input = case["input"].as_str().unwrap();
        let profile = case["languageProfile"].as_str().unwrap_or("en");
        let chunks = KeySpec::new(profile, profile).chunk(input);
        let expected: Vec<Vec<String>> = case["chunks"]
            .as_array()
            .unwrap()
            .iter()
            .map(strings)
            .collect();
        let pairs = strings(&case["modelPairs"]);
        let formats = strings(&case["formats"]);
        // Chinese cases also name the merged Han runs and the single characters.
        let merged = case.get("merged").map(strings);
        let singles = case.get("singles").map(strings);
        if chunks.chunks != expected
            || chunks.model_pairs != pairs
            || chunks.formats != formats
            || merged.as_ref().is_some_and(|m| *m != chunks.merged)
            || singles.as_ref().is_some_and(|s| *s != chunks.singles)
        {
            failures.push(format!(
                "{input}: {:?} {:?} {:?} {:?} {:?}, expected {expected:?} {pairs:?} {formats:?} {merged:?} {singles:?}",
                chunks.chunks, chunks.model_pairs, chunks.formats, chunks.merged, chunks.singles
            ));
        }
    }
    println!(
        "key_spec_golden.json: {} of {} cases pass",
        cases.len() - failures.len(),
        cases.len()
    );
    assert!(failures.is_empty(), "{failures:#?}");
}

fn key(spec: &KeySpec, phrase: &str) -> String {
    let keys = spec.keys_of(phrase);
    assert_eq!(keys.len(), 1, "{phrase} reads as {keys:?}");
    keys.into_iter().next().unwrap()
}

#[test]
fn runs_stay_inside_a_chunk_and_hold_at_most_three_words() {
    let spec = KeySpec::default();
    let mut runs: Vec<String> = spec
        .chunk("Lo-Fi Hip Hop Radio: chill study beats")
        .runs()
        .into_iter()
        .map(|run| run.key)
        .collect();
    let mut expected: Vec<String> = [
        "lofi hip hop",
        "hip hop radio",
        "chill study",
        "chill study beats",
        "study beats",
    ]
    .iter()
    .map(|phrase| key(&spec, phrase))
    .collect();
    runs.sort();
    expected.sort();
    assert_eq!(runs, expected);
}

#[test]
fn the_platform_and_its_bait_words_never_become_interests() {
    let words = KeySpec::default()
        .chunk("YouTube's most hilarious coding fails")
        .words();
    assert_eq!(words, ["code", "fails"]);
}

#[test]
fn every_spelling_of_an_apostrophe_reads_the_same() {
    let spec = KeySpec::default();
    for spelling in ["Tech's", "Tech’s", "Tech‘s", "Techʼs", "Tech`s", "Tech´s"] {
        assert_eq!(spec.chunk(spelling).words(), ["tech"], "{spelling}");
    }
}

#[test]
fn a_label_reads_as_the_keys_titles_give_it() {
    let spec = KeySpec::default();
    assert_eq!(spec.keys_of("Health & Fitness"), ["health", "fitness"]);
    assert_eq!(spec.keys_of("Call of Duty"), ["call of duty"]);
    assert_eq!(spec.keys_of("Lo-Fi"), ["lofi"]);
    assert_eq!(spec.keys_of("Web Development"), ["web development"]);
    assert!(spec.keys_of("   ").is_empty());
    assert!(spec.keys_of("").is_empty());
}

#[test]
fn a_stored_key_reads_again_by_spec_2() {
    let spec = KeySpec::default();
    assert_eq!(spec.rekey("guitars"), ["guitar"]);
    assert_eq!(spec.rekey("guitar"), ["guitar"]);
    assert_eq!(spec.rekey("kayaking"), ["kayak"]);
    assert_eq!(spec.rekey("tech's"), ["tech"]);
    assert_eq!(spec.rekey("lo-fi"), ["lofi"]);
    assert_eq!(spec.rekey("lo fi hip hop"), ["lofi hip hop"]);
    assert_eq!(spec.rekey("~guitars"), ["~guitar"]);
    assert_eq!(spec.rekey("metal guitars:music"), ["metal guitar:music"]);
    assert_eq!(spec.rekey("health & fitness"), ["health", "fitness"]);
    assert!(spec.rekey("m/v").is_empty());
}

#[test]
fn keys_already_read_stay_as_they_are() {
    let spec = KeySpec::default();
    let golden: Value = serde_json::from_str(GOLDEN).unwrap();
    let mut keys = vec![
        "guitars".to_string(),
        "kayaking".to_string(),
        "~tech's:music".to_string(),
    ];
    for case in golden["cases"].as_array().unwrap() {
        let chunks = spec.chunk(case["input"].as_str().unwrap());
        keys.extend(chunks.words());
        keys.extend(chunks.runs().into_iter().map(|run| run.key));
    }
    for key in keys {
        for once in spec.rekey(&key) {
            assert_eq!(spec.rekey(&once), std::slice::from_ref(&once), "{key}");
        }
    }
}

#[test]
fn a_pair_that_keeps_appearing_together_becomes_a_phrase_and_a_chance_pair_does_not() {
    let frequencies: HashMap<String, i32> = [
        ("guitar playalong", 6),
        ("guitar", 8),
        ("playalong", 6),
        ("review after", 3),
        ("review", 30),
        ("after", 25),
    ]
    .into_iter()
    .map(|(word, count)| (word.to_string(), count))
    .collect();
    let idf = IdfSnapshot {
        word_frequencies: frequencies.clone(),
        total_documents: 100,
    };
    assert!(is_phrase("guitar playalong", &idf));
    assert!(!is_phrase("review after", &idf));
    let fewer = IdfSnapshot {
        word_frequencies: frequencies,
        total_documents: 10,
    };
    assert!(!is_phrase("guitar playalong", &fewer));
}

// Android checks these on a device, where ICU's dictionaries live; ICU4X ships the same ones.
#[test]
fn unspaced_scripts_split_into_dictionary_words() {
    let spec = KeySpec::default();
    let words = |title: &str| spec.chunk(title).words();

    let chinese = words("吉他教学零基础入门");
    assert!(chinese.contains(&"吉他".to_string()), "{chinese:?}");
    // Key spec 3 reads "教学" as the tutorial format, never a topic.
    assert!(!chinese.contains(&"教学".to_string()), "{chinese:?}");
    assert_eq!(spec.chunk("吉他教学零基础入门").formats, ["tutorial"]);

    let japanese = words("ギターの弾き方を初心者向けに解説");
    assert!(japanese.contains(&"ギター".to_string()), "{japanese:?}");
    assert!(
        !japanese.iter().any(|w| w == "の" || w == "を"),
        "{japanese:?}"
    );

    let thai = words("สอนเล่นกีตาร์สำหรับมือใหม่");
    assert!(thai.contains(&"กีตาร์".to_string()), "{thai:?}");
    assert!(thai.contains(&"สำหรับ".to_string()), "{thai:?}");

    let spaced = words("Pixel 10 Pro camera test");
    assert!(spaced.contains(&"pixel".to_string()), "{spaced:?}");
    assert!(spaced.contains(&"camera".to_string()), "{spaced:?}");
}

// Android NeuroHanRunsTest.
#[test]
fn traditional_characters_read_as_simplified_ones() {
    use flow_desktop_lib::flow_neuro::keyspec::text::fold;
    assert_eq!(fold("機器學習"), "机器学习");
    let spec = KeySpec::default();
    assert_eq!(
        spec.chunk("英語學習 如何學好英文").chunks,
        spec.chunk("英语学习 如何学好英文").chunks
    );
}

#[test]
fn text_with_kana_is_japanese_and_its_kanji_stay() {
    use flow_desktop_lib::flow_neuro::keyspec::text::fold;
    assert_eq!(fold("宮崎駿 ジブリ"), "宮崎駿 ジブリ");
    assert_eq!(fold("宮崎駿"), "宫崎骏");
}

#[test]
fn the_fold_table_maps_one_character_to_one_that_maps_no_further() {
    use flow_desktop_lib::flow_neuro::keyspec::text::fold;
    let table = include_str!("../resources/neuro/fold/hant-hans.txt");
    let lines: Vec<&str> = table
        .lines()
        .filter(|line| !line.starts_with('#'))
        .collect();
    let traditional: std::collections::HashSet<char> = lines
        .iter()
        .filter_map(|line| line.chars().next())
        .collect();
    assert!(lines.len() >= 2000);
    for line in lines {
        let chars: Vec<char> = line.chars().collect();
        assert_eq!(chars.len(), 2, "{line}");
        assert!(!traditional.contains(&chars[1]), "{line}");
        assert_eq!(fold(&chars[0].to_string()), chars[1].to_string(), "{line}");
    }
}

#[test]
fn single_han_characters_merge_into_one_candidate() {
    let spec = KeySpec::default();
    let merged = |title: &str| spec.chunk(title).merged;
    assert_eq!(merged("【4K】周杰倫 演唱會 完整版"), ["周杰伦", "演唱会"]);
    assert_eq!(merged("李永樂老師 講解 相對論"), ["李永乐", "相对论"]);
    assert!(
        !spec
            .chunk("周杰倫 演唱會")
            .chunks
            .contains(&vec!["周杰伦".to_string()])
    );
    assert_eq!(merged("老高與小茉"), ["老高", "小茉"]);
    assert_eq!(merged("周杰倫的新歌"), ["周杰伦"]);
    assert!(merged("iPhone 17 Pro 開箱評測").is_empty());
    assert!(merged("周杰倫周杰倫").is_empty(), "at most five characters");
    assert_eq!(merged("周杰"), ["周杰"]);
    assert!(
        merged("周 杰 倫").is_empty(),
        "characters apart are not one run"
    );
    assert!(merged("周，杰，倫").is_empty());
}

#[test]
fn japanese_and_earlier_specs_merge_nothing() {
    use flow_desktop_lib::flow_neuro::keyspec::tables::run_breaks;
    let spec = KeySpec::default();
    assert!(spec.chunk("大谷翔平 ホームラン 50号").merged.is_empty());
    assert!(run_breaks("ja").is_none());
    let spec_2 = spec.at_version(2);
    assert!(spec_2.chunk("周杰倫 演唱會").merged.is_empty());
    assert_eq!(spec_2.chunk("英語學習").chunks, [["英語", "學習"]]);
}

#[test]
fn japanese_stop_lists_keep_their_kanji() {
    let stop = KeySpec::stop_list("ja");
    for word in ["私達", "貴方", "貴方方"] {
        assert!(stop.contains(word), "{word}");
    }
}
