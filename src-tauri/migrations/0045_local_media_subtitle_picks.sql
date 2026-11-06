-- Subtitle files someone picked for a library video in the system's file dialog, kept so
-- reopening the video brings them back. Device rows, like the library itself.
CREATE TABLE IF NOT EXISTS local_media_subtitle_picks (
    file_id TEXT NOT NULL,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    added_ms INTEGER NOT NULL,
    PRIMARY KEY (file_id, path)
);
