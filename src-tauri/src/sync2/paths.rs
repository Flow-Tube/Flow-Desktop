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
