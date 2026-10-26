-- What the scrobbling keychain item holds, minus every secret, so the app can show sign-in state
-- and skip the keychain entirely when nobody is signed in. Each keychain read can raise a macOS
-- password prompt, so it must only happen when a listen is actually sent.
-- Device-local, never synced or backed up. Rebuilt from the keychain whenever it is read.
-- service: LASTFM, LIBREFM or LISTENBRAINZ.
CREATE TABLE IF NOT EXISTS scrobble_accounts (
    service   TEXT PRIMARY KEY NOT NULL,
    user_name TEXT NOT NULL DEFAULT ''
);

-- One row once the keychain has been read at least once; until then the accounts table is unknown.
-- own_key_hint is the first characters of the listener's Last.fm API key, never the secret.
CREATE TABLE IF NOT EXISTS scrobble_keychain_state (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    own_key_enabled INTEGER NOT NULL DEFAULT 0,
    own_key_usable  INTEGER NOT NULL DEFAULT 0,
    own_key_hint    TEXT    NOT NULL DEFAULT ''
);
