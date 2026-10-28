-- Videos whose kind was read from their player response, so each is looked up once. is_short is
-- 0 for a landscape or longer upload, one with no format to tell, or one that will never play.
-- A Short found this way is also kept in known_shorts. Device-local, never synced or backed
-- up. checked_at is epoch milliseconds; rows older than 30 days are let go.
CREATE TABLE IF NOT EXISTS video_kind_checks (
    video_id   TEXT PRIMARY KEY NOT NULL,
    is_short   INTEGER NOT NULL,
    checked_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_video_kind_checks_checked_at ON video_kind_checks (checked_at);
