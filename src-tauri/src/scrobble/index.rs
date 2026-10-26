//! What the keychain item holds, minus the secrets, kept in SQLite. Status and queueing read it
//! here, so only sending a listen ever needs the keychain.

use sqlx::{Row, SqlitePool};

use super::audioscrobbler::Keys;
use super::credentials::Credentials;
use super::models::Service;
use crate::errors::AppResult;

const VISIBLE_KEY_CHARS: usize = 6;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OwnKeyState {
    pub enabled: bool,
    /// Both the key and the secret are filled in.
    pub usable: bool,
    /// The first characters of the API key, never the secret.
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Index {
    /// Signed-in services with the user name to show, in [`Service::ALL`] order.
    pub accounts: Vec<(Service, String)>,
    pub own_key: OwnKeyState,
}

impl Index {
    pub fn services(&self) -> impl Iterator<Item = Service> + '_ {
        self.accounts.iter().map(|(service, _)| *service)
    }

    pub fn user_name(&self, service: Service) -> Option<&str> {
        self.accounts
            .iter()
            .find(|(signed_in, _)| *signed_in == service)
            .map(|(_, name)| name.as_str())
    }
}

/// `None` until the keychain has been read once, since then nothing is known yet.
pub async fn read(pool: &SqlitePool) -> AppResult<Option<Index>> {
    let Some(state) = sqlx::query(
        "SELECT own_key_enabled, own_key_usable, own_key_hint FROM scrobble_keychain_state WHERE id = 1",
    )
    .fetch_optional(pool)
    .await?
    else {
        return Ok(None);
    };
    let rows = sqlx::query("SELECT service, user_name FROM scrobble_accounts")
        .fetch_all(pool)
        .await?;
    let accounts = Service::ALL
        .into_iter()
        .filter_map(|service| {
            rows.iter()
                .find(|row| row.get::<String, _>("service") == service.as_str())
                .map(|row| (service, row.get::<String, _>("user_name")))
        })
        .collect();
    let hint: String = state.get("own_key_hint");
    Ok(Some(Index {
        accounts,
        own_key: OwnKeyState {
            enabled: state.get("own_key_enabled"),
            usable: state.get("own_key_usable"),
            hint: (!hint.is_empty()).then_some(hint),
        },
    }))
}

/// Replaces the index with what the keychain item now holds.
pub async fn rebuild(pool: &SqlitePool, credentials: &Credentials) -> AppResult<()> {
    let own_key = &credentials.own_key;
    let usable = Keys {
        api_key: own_key.api_key.clone(),
        secret: own_key.secret.clone(),
    }
    .is_usable();
    let hint: String = own_key
        .api_key
        .trim()
        .chars()
        .take(VISIBLE_KEY_CHARS)
        .collect();

    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM scrobble_accounts")
        .execute(&mut *tx)
        .await?;
    for (service, account) in &credentials.accounts {
        sqlx::query("INSERT INTO scrobble_accounts (service, user_name) VALUES (?, ?)")
            .bind(service.as_str())
            .bind(&account.user_name)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query(
        "INSERT INTO scrobble_keychain_state (id, own_key_enabled, own_key_usable, own_key_hint)
         VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET own_key_enabled = excluded.own_key_enabled,
             own_key_usable = excluded.own_key_usable, own_key_hint = excluded.own_key_hint",
    )
    .bind(own_key.enabled)
    .bind(usable)
    .bind(hint)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}
