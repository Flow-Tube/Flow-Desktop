-- Notes on videos and channels, as Flow for Android keeps them: `id` is `video:<id>` or
-- `channel:<id>`, `kind` is `Video` or `Channel`, and `updated_at` is the edit time in ms that the
-- merge compares. `title` onwards say what the note is about, so the Notes page needs no network.
-- `position` is this device's hand-made order and never travels.
CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY NOT NULL,
    target_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    title TEXT,
    channel_name TEXT,
    channel_id TEXT,
    thumbnail_url TEXT,
    duration_seconds INTEGER,
    channel_avatar_url TEXT,
    channel_handle TEXT,
    subscriber_count_text TEXT,
    position INTEGER
);

-- Builds before this one read other devices' notes batches and dropped them, and their snapshots
-- left notes out. The next linked sync reads those notes again from what the store still keeps,
-- then writes a snapshot that holds them, so a new device starting from it gets them.
INSERT OR IGNORE INTO settings (key, value)
    SELECT 'sync2_notes_missed', '1' FROM sync2_group;
UPDATE sync2_snapshots SET written_ms = 0 WHERE link != '';
