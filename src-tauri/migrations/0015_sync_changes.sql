-- When each synced record last changed on this device, and the deletions sync must still announce.
-- Likes, playlists and subscription groups live in frontend JSON blobs that keep neither an edit time
-- nor anything about what was removed, and a deleted watch_history row is simply gone, so without
-- this a peer re-adds whatever was deleted here and every edit loses to the peer's copy.
--
-- collection: the sync collection key, plus `playlist_items` for tracks inside a playlist.
-- item_key:   the record's merge key (`video:<id>` for likes, `<syncId>|<videoId>` for tracks).
-- deleted:    1 = a tombstone that still has to reach other devices.
-- record:     the canonical JSON to send for a tombstone (a peer's verbatim, or this device's
--             template); NULL for a plain edit time.
-- from_peer:  1 = the tombstone came from another device and is relayed exactly as received.
CREATE TABLE IF NOT EXISTS sync_changes (
    collection    TEXT    NOT NULL,
    item_key      TEXT    NOT NULL,
    changed_at_ms INTEGER NOT NULL,
    deleted       INTEGER NOT NULL DEFAULT 0,
    record        TEXT,
    from_peer     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (collection, item_key)
);
