//! Device names and platforms, as the latest roster entry naming each device says.

use std::collections::BTreeMap;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;

use super::engine::{Result, Session};
use super::linking::DeviceMeta;
use super::meta::open_device_meta;
use super::roster::apply_entry;
use super::store::Store;

/// Names are only shown, so one that can't be read is left out and the latest readable one stays.
pub async fn device_names<S: Store>(
    session: &mut Session<'_, S>,
) -> Result<BTreeMap<String, DeviceMeta>> {
    let entries = session.entries().to_vec();
    let mut names = BTreeMap::new();
    let mut state = None;
    for entry in &entries {
        let after = apply_entry(state.as_ref(), entry)?;
        for (did, sealed) in entry.meta.iter().flatten() {
            if let Some(meta) = open_name(session, after.epoch, entry.seq, did, sealed).await {
                names.insert(did.clone(), meta);
            }
        }
        state = Some(after);
    }
    Ok(names)
}

async fn open_name<S: Store>(
    session: &mut Session<'_, S>,
    epoch: u32,
    seq: u64,
    did: &str,
    sealed: &str,
) -> Option<DeviceMeta> {
    let key = session.epoch_key(epoch).await.ok()?;
    open_sealed_name(&key, session.group(), (epoch, seq), did, sealed)
}

/// The name sealed in a roster entry at `seq` under the key of `epoch`.
pub(super) fn open_sealed_name(
    key: &[u8],
    group: &[u8; 16],
    (epoch, seq): (u32, u64),
    did: &str,
    sealed: &str,
) -> Option<DeviceMeta> {
    let sealed = URL_SAFE_NO_PAD.decode(sealed).ok()?;
    let did = hex::decode(did).ok()?;
    let content = open_device_meta(key, group, epoch, seq, &did, &sealed).ok()?;
    serde_json::from_str(&content).ok()
}
