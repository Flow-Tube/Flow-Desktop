//! Store paths (spec/store.md, Layout).

pub fn roster_path(seq: u64, hash: &str) -> String {
    format!("roster/{seq:016x}-{}.r", &hash[..16])
}

pub fn wrap_path(epoch: u32, did: &str) -> String {
    format!("keys/{epoch:08x}/{did}.k")
}

pub fn chain_path(epoch: u32) -> String {
    format!("keys/{epoch:08x}/chain.k")
}

pub fn log_path(did: &str, seq: u64) -> String {
    format!("dev/{did}/log/{:016x}/{seq:016x}.o", seq >> 10)
}

pub fn blob_path(did: &str, hash: &str) -> String {
    format!("dev/{did}/blob/{hash}.b")
}

/// The sender and sequence of a log object path, or `None` for any other path.
pub fn parse_log_path(path: &str) -> Option<(String, u64)> {
    let rest = path.strip_prefix("dev/")?;
    let (did, rest) = rest.split_once("/log/")?;
    let (shard, file) = rest.split_once('/')?;
    let seq = u64::from_str_radix(file.strip_suffix(".o")?, 16).ok()?;
    let valid = did.len() == 32
        && did
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase());
    (valid && log_path(did, seq) == path && shard.len() == 16).then(|| (did.to_owned(), seq))
}
