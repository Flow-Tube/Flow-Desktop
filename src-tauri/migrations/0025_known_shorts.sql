-- Videos known to be Shorts, by id, wherever one was seen as a Short: an RSS link to the Shorts
-- player, a channel's Shorts tab, a search Shorts shelf, the Shorts feed. Home leaves these out
-- even when a later source offers one without saying it is a Short.
-- Device-local, never synced or backed up. seen_at is epoch milliseconds.
CREATE TABLE IF NOT EXISTS known_shorts (
    video_id TEXT PRIMARY KEY NOT NULL,
    seen_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_known_shorts_seen_at ON known_shorts (seen_at);
