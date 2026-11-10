-- The folder library. Folders and files are device rows (read from Default's database, like
-- downloads); plays belong to each profile. None of these tables is a sync collection.
CREATE TABLE IF NOT EXISTS local_media_folders (
    path TEXT PRIMARY KEY NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('include', 'exclude')),
    added_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS local_media_files (
    id TEXT PRIMARY KEY NOT NULL,
    path TEXT NOT NULL UNIQUE,
    folder_path TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('video', 'audio')),
    title TEXT NOT NULL,
    file_name TEXT NOT NULL,
    artist TEXT NOT NULL DEFAULT '',
    album TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER NOT NULL DEFAULT 0,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    added_ms INTEGER NOT NULL DEFAULT 0,
    modified_ms INTEGER NOT NULL DEFAULT 0,
    width INTEGER NOT NULL DEFAULT 0,
    height INTEGER NOT NULL DEFAULT 0,
    frame_rate REAL,
    bitrate_kbps INTEGER,
    video_codec TEXT NOT NULL DEFAULT '',
    audio_codec TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS local_media_plays (
    file_id TEXT PRIMARY KEY NOT NULL,
    position_ms INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    last_played_ms INTEGER NOT NULL
);
