//! Creating a group on a fresh Flow sync server.

use std::collections::BTreeMap;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sqlx::SqlitePool;

use super::engine::{EngineError, Result};
use super::entries::{Draft, build_entry, epoch_draft, member_subject};
use super::keys::MemberSecrets;
use super::linking::DeviceMeta;
use super::meta::seal_device_meta;
use super::recovery::{recovery_keys, recovery_secret, recovery_words};
use super::recovery_flow::restore;
use super::roster::{Op, Role, replay_roster};
use super::sealed::random_bytes;
use super::server::ServerStore;
use super::state::{GroupRecord, add_roster_entries, save_group};
use super::store::Store;
use super::wrap::wrap_epoch_key;
use crate::sync::canonical::to_canonical_json;

/// Creates the group with this device and a new recovery key, claims the server with the
/// operator's admin token, and returns the recovery words to show once.
pub async fn create_group(
    pool: &SqlitePool,
    store_url: &str,
    admin_token: &str,
    device: &MemberSecrets,
    meta: &DeviceMeta,
    link: &str,
) -> Result<String> {
    let group: [u8; 16] = random_bytes();
    let epoch_key: [u8; 32] = random_bytes();
    let recovery_secret: [u8; 32] = random_bytes();
    let recovery = recovery_keys(&recovery_secret);
    let sealed_meta = seal_device_meta(
        &epoch_key,
        &group,
        0,
        0,
        &device.did,
        &to_canonical_json(meta),
    )?;
    let draft = Draft {
        op: Op::Genesis,
        signer: hex::encode(device.did),
        add: Some(vec![
            member_subject(&device.sig_public, &device.kem_public, Role::Device),
            member_subject(&recovery.sig_public, &recovery.kem_public, Role::Recovery),
        ]),
        remove: None,
        epoch: Some(epoch_draft(
            &epoch_key,
            &group,
            0,
            &[device.did, recovery.did],
        )),
        meta: Some(BTreeMap::from([(
            hex::encode(device.did),
            URL_SAFE_NO_PAD.encode(sealed_meta),
        )])),
    };
    let genesis = build_entry(&group, None, draft, &[device, &recovery]);
    let mut wraps = BTreeMap::new();
    for member in [device, &recovery] {
        let wrap = wrap_epoch_key(&member.kem_public, &group, 0, &member.did, &epoch_key)?;
        wraps.insert(hex::encode(member.did), URL_SAFE_NO_PAD.encode(wrap));
    }

    let store =
        ServerStore::connect(store_url, device.clone(), None, Some(hex::encode(group))).await?;
    store.claim(admin_token, &genesis, &wraps).await?;
    let roster = store.roster_after(-1).await?;
    if replay_roster(&roster)?.head != replay_roster(std::slice::from_ref(&genesis))?.head {
        return Err(EngineError::Unexpected);
    }
    add_roster_entries(pool, &roster).await?;
    let (instance, _) = store.identity().await;
    let record = GroupRecord::new(
        hex::encode(group),
        store_url.to_owned(),
        instance,
        link.to_owned(),
    );
    save_group(pool, &record).await?;
    Ok(recovery_words(&recovery_secret))
}

/// Restores the group onto this device from the recovery words, replaces the recovery key, and
/// returns the new words to show once. The profile link is chosen on the first sync, by
/// [`Session::adopt_link`](super::engine::Session::adopt_link).
pub async fn restore_group(
    pool: &SqlitePool,
    store_url: &str,
    words: &str,
    device: &MemberSecrets,
    meta: &DeviceMeta,
) -> Result<String> {
    let secret = recovery_secret(words).ok_or(EngineError::WrongWords)?;
    let as_recovery = ServerStore::connect(store_url, recovery_keys(&secret), None, None).await?;
    let as_device = ServerStore::connect(store_url, device.clone(), None, None).await?;
    let restored = restore(
        &as_recovery,
        &as_device,
        &recovery_keys(&secret),
        device,
        meta,
    )
    .await?;
    let (instance, group) = as_device.identity().await;
    if (instance.clone(), group.clone()) != as_recovery.identity().await {
        return Err(EngineError::Unexpected);
    }
    let group = group.ok_or(EngineError::Unexpected)?;
    replay_roster(&restored.entries)?;
    add_roster_entries(pool, &restored.entries).await?;
    save_group(
        pool,
        &GroupRecord::new(group, store_url.to_owned(), instance, String::new()),
    )
    .await?;
    Ok(restored.words)
}
