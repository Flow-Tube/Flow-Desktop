-- FLOW-SYNC/2 profiles (spec/protocol.md, Profiles): each synced profile has a link, and devices
-- keep what other profiles need until they run. Kept in Default's database, like the group.

-- Which local profile syncs which link. A group joined before this starts with the link Default
-- joined (`sync2_group.link`), filled in by the app, which knows Default's id.
CREATE TABLE IF NOT EXISTS sync2_profile_links (
    profile TEXT PRIMARY KEY,
    link TEXT NOT NULL UNIQUE
);

-- What was sent, now per link. `link` is empty for the profiles collection.
CREATE TABLE IF NOT EXISTS sync2_sent_links (
    link TEXT NOT NULL,
    collection TEXT NOT NULL,
    record_key TEXT NOT NULL,
    hash TEXT NOT NULL,
    sent_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (link, collection, record_key)
);
INSERT OR IGNORE INTO sync2_sent_links (link, collection, record_key, hash, sent_at)
    SELECT g.link, s.collection, s.record_key, s.hash, s.sent_at
    FROM sync2_sent s, sync2_group g WHERE g.link != '';

-- Batches for a linked profile that isn't running, applied in `id` order once it runs. `part`
-- numbers the blobs of a snapshot read for that link; it is 0 for a batch.
CREATE TABLE IF NOT EXISTS sync2_kept (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link TEXT NOT NULL,
    sender TEXT NOT NULL,
    seq INTEGER NOT NULL,
    part INTEGER NOT NULL DEFAULT 0,
    collection TEXT NOT NULL,
    head TEXT NOT NULL,
    records BLOB NOT NULL,
    UNIQUE (link, sender, seq, part)
);

-- The profiles collection: each link's name, merged last-writer-wins by `hlc`.
CREATE TABLE IF NOT EXISTS sync2_profiles (
    link TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    hlc TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
);

-- A link read from a snapshot already includes its batches up to `seq` of each sender.
CREATE TABLE IF NOT EXISTS sync2_floors (
    link TEXT NOT NULL,
    did TEXT NOT NULL,
    seq INTEGER NOT NULL,
    PRIMARY KEY (link, did)
);

-- Links a profile joined that are still to be read from their snapshot.
CREATE TABLE IF NOT EXISTS sync2_reading (
    link TEXT PRIMARY KEY
);
