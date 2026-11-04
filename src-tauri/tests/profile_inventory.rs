//! Every table, settings key, keychain entry and app-folder call site must be classified in
//! `tests/profiles/store_inventory.tsv` before it ships, so a new store can never be shared
//! between profiles by accident.

use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

const SCOPES: [&str; 5] = ["DEVICE", "PROFILE", "CACHE", "DEFAULT_ONLY", "DEAD"];

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn inventory() -> HashMap<(String, String), String> {
    let text = fs::read_to_string(manifest_dir().join("tests/profiles/store_inventory.tsv"))
        .expect("store_inventory.tsv");
    let mut rows = HashMap::new();
    for (index, line) in text.lines().enumerate() {
        if line.trim().is_empty() || line.starts_with('#') {
            continue;
        }
        let cols: Vec<&str> = line.split('\t').collect();
        assert_eq!(
            cols.len(),
            5,
            "line {} needs 5 tab-separated columns",
            index + 1
        );
        assert!(
            SCOPES.contains(&cols[2]),
            "line {}: unknown scope {}",
            index + 1,
            cols[2]
        );
        assert!(
            !cols[4].trim().is_empty(),
            "line {}: give a reason",
            index + 1
        );
        let key = (cols[0].to_string(), cols[1].to_string());
        assert!(
            rows.insert(key, cols[2].to_string()).is_none(),
            "line {} is a duplicate",
            index + 1
        );
    }
    rows
}

fn rust_sources() -> Vec<(String, String)> {
    let root = manifest_dir();
    let mut out = Vec::new();
    let mut stack = vec![root.join("src")];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).expect("read src") {
            let path = entry.expect("entry").path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|ext| ext == "rs") {
                let rel = path
                    .strip_prefix(&root)
                    .expect("relative")
                    .to_string_lossy()
                    .replace('\\', "/");
                out.push((rel, fs::read_to_string(&path).expect("read source")));
            }
        }
    }
    out.sort();
    out
}

/// Code before the first `#[cfg(test)]`, so test fixtures don't count as stores.
fn non_test(source: &str) -> &str {
    source.split("#[cfg(test)]").next().unwrap_or(source)
}

fn string_after(text: &str) -> Option<&str> {
    let start = text.find('"')? + 1;
    let end = start + text[start..].find('"')?;
    Some(&text[start..end])
}

fn is_identifier(text: &str) -> bool {
    !text.is_empty() && text.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

#[test]
fn every_migration_table_is_classified() {
    let rows = inventory();
    let mut missing = BTreeSet::new();
    for entry in fs::read_dir(manifest_dir().join("migrations")).expect("migrations") {
        let sql = fs::read_to_string(entry.expect("entry").path()).expect("read migration");
        let upper = sql.to_ascii_uppercase();
        let mut from = 0;
        while let Some(found) = upper[from..].find("CREATE TABLE") {
            let mut rest = sql[from + found + "CREATE TABLE".len()..].trim_start();
            if rest.to_ascii_uppercase().starts_with("IF NOT EXISTS") {
                rest = rest["IF NOT EXISTS".len()..].trim_start();
            }
            let name: String = rest
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                .collect();
            if !rows.contains_key(&("table".into(), name.clone())) {
                missing.insert(name);
            }
            from += found + "CREATE TABLE".len();
        }
    }
    assert!(
        missing.is_empty(),
        "classify these tables in store_inventory.tsv: {missing:?}"
    );
}

/// Settings keys the backend names itself: `const …KEY/SETTING/FLAG: &str = "…"` in a file
/// that touches the settings table, and string literals passed straight to the helpers.
#[test]
fn every_backend_settings_key_is_classified() {
    let rows = inventory();
    let mut missing = BTreeSet::new();
    for (path, source) in rust_sources() {
        let code = non_test(&source);
        let uses_settings = code.contains("get_setting") || code.contains("set_setting");
        if !uses_settings {
            continue;
        }
        for line in code.lines() {
            let trimmed = line.trim_start();
            let Some(decl) = trimmed
                .strip_prefix("pub(crate) const ")
                .or_else(|| trimmed.strip_prefix("pub const "))
                .or_else(|| trimmed.strip_prefix("const "))
            else {
                continue;
            };
            let Some((name, value)) = decl.split_once(": &str =") else {
                continue;
            };
            let named_as_key = name.ends_with("KEY")
                || name.starts_with("KEY_")
                || name.contains("SETTING")
                || name.ends_with("FLAG");
            if let Some(key) = string_after(value).filter(|key| {
                named_as_key
                    && is_identifier(key)
                    && !rows.contains_key(&("setting".into(), key.to_string()))
            }) {
                missing.insert(format!("{key} ({path})"));
            }
        }
        for helper in [
            "get_setting(",
            "set_setting(",
            "get_setting_value(",
            "set_setting_value(",
            "get_setting_with_time(",
        ] {
            let mut from = 0;
            while let Some(found) = code[from..].find(helper) {
                let args = &code[from + found + helper.len()..];
                from += found + helper.len();
                let Some((_, second)) = args.split_once(',') else {
                    continue;
                };
                let second = second.trim_start();
                if !second.starts_with('"') {
                    continue;
                }
                if let Some(key) = string_after(second).filter(|key| {
                    is_identifier(key) && !rows.contains_key(&("setting".into(), key.to_string()))
                }) {
                    missing.insert(format!("{key} ({path})"));
                }
            }
        }
    }
    assert!(
        missing.is_empty(),
        "classify these settings keys in store_inventory.tsv: {missing:?}"
    );
}

#[test]
fn keychain_entries_are_only_built_in_credentials() {
    let offenders: Vec<String> = rust_sources()
        .into_iter()
        .filter(|(path, source)| {
            path != "src/security/keychain.rs" && non_test(source).contains("Entry::new(")
        })
        .map(|(path, _)| path)
        .collect();
    assert!(
        offenders.is_empty(),
        "keychain entries must go through security/keychain.rs: {offenders:?}"
    );
}

#[test]
fn app_folder_call_sites_are_classified() {
    let rows = inventory();
    let calls = [
        "app_data_dir()",
        "app_config_dir()",
        "app_cache_dir()",
        "app_local_data_dir()",
        "app_log_dir()",
    ];
    let missing: Vec<String> = rust_sources()
        .into_iter()
        .filter(|(_, source)| calls.iter().any(|call| non_test(source).contains(call)))
        .map(|(path, _)| path)
        .filter(|path| !rows.contains_key(&("dir_site".into(), path.clone())))
        .collect();
    assert!(
        missing.is_empty(),
        "classify these files that resolve app folders: {missing:?}"
    );
}

#[test]
fn inventory_files_still_exist() {
    let root = manifest_dir();
    let stale: Vec<String> = inventory()
        .into_keys()
        .filter(|(kind, name)| kind == "dir_site" && !Path::new(&root.join(name)).exists())
        .map(|(_, name)| name)
        .collect();
    assert!(stale.is_empty(), "remove stale dir_site rows: {stale:?}");
}

/// Rows every profile shares are only touched by these modules, and every function in them
/// starts by taking Default's pool from `db::device`.
#[test]
fn device_tables_go_through_the_device_pool() {
    let owners = [
        "src/db/downloads.rs",
        "src/db/download_collections.rs",
        "src/db/download_jobs.rs",
        "src/sync/ledger.rs",
    ];
    let tables = [
        "downloads",
        "download_collections",
        "download_jobs",
        "sync_identity",
    ];
    let mut problems = Vec::new();
    for (path, source) in rust_sources() {
        let code = non_test(&source);
        let mentions = |table: &str| {
            ["FROM ", "INTO ", "UPDATE ", "JOIN "].iter().any(|verb| {
                code.contains(&format!("{verb}{table} "))
                    || code.contains(&format!("{verb}{table}\n"))
            })
        };
        let touched: Vec<&str> = tables
            .iter()
            .copied()
            .filter(|table| mentions(table))
            .collect();
        if touched.is_empty() {
            continue;
        }
        if !owners.contains(&path.as_str()) {
            problems.push(format!("{path} queries {touched:?}"));
            continue;
        }
        for chunk in code.split("pub async fn ").skip(1) {
            let body = chunk.split_once('{').map_or("", |(_, body)| body);
            let name: String = chunk
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                .collect();
            let touches_device = tables
                .iter()
                .any(|table| body.split("\npub ").next().unwrap_or("").contains(table));
            if touches_device && !body.trim_start().contains("crate::db::device::pool(pool)") {
                problems.push(format!(
                    "{path}::{name} must start with crate::db::device::pool(pool)"
                ));
            }
        }
    }
    assert!(problems.is_empty(), "{problems:#?}");
}

#[test]
fn device_settings_in_the_inventory_are_routed_as_device_keys() {
    use flow_desktop_lib::profiles::device_keys::is_device_key;
    let wrong: Vec<String> = inventory()
        .into_iter()
        .filter(|((kind, _), _)| kind == "setting")
        .filter(|((_, name), scope)| (scope == "DEVICE") != is_device_key(name))
        .map(|((_, name), scope)| format!("{name} is {scope}"))
        .collect();
    assert!(
        wrong.is_empty(),
        "inventory and device_keys.rs disagree: {wrong:?}"
    );
}
