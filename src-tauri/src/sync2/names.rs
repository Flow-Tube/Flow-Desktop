//! Device names and platforms, as the latest roster entry naming each device says.

use std::collections::BTreeMap;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;

use super::engine::{EngineError, Result, Session};
use super::linking::DeviceMeta;
use super::meta::open_device_meta;
use super::roster::apply_entry;
use super::store::Store;
use super::{Error, array};

pub async fn device_names<S: Store>(
    session: &mut Session<'_, S>,
) -> Result<BTreeMap<String, DeviceMeta>> {
    let group: [u8; 16] = *session.group();
    let entries = session.entries().to_vec();
    let mut names = BTreeMap::new();
    let mut state = None;
    for entry in &entries {
        let after = apply_entry(state.as_ref(), entry)?;
        for (did, sealed) in entry.meta.iter().flatten() {
            let key = session.epoch_key(after.epoch).await?;
            let sealed = URL_SAFE_NO_PAD
                .decode(sealed)
                .map_err(|_| Error::RosterFormat)?;
            let did_bytes: [u8; 16] = array(&hex::decode(did).map_err(|_| Error::RosterFormat)?);
            let content =
                open_device_meta(&key, &group, after.epoch, entry.seq, &did_bytes, &sealed)?;
            let meta = serde_json::from_str(&content).map_err(|_| EngineError::Unexpected)?;
            names.insert(did.clone(), meta);
        }
        state = Some(after);
    }
    Ok(names)
}
