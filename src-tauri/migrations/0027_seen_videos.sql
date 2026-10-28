-- Videos whose card stayed on screen in a recommendation list (Home, its chips, the Watch page's
-- related videos): at least half visible for half a second. With "Hide videos you've already seen"
-- on, these are never recommended again. Newest 100,000 kept. Device-local, never synced or backed
-- up. seen_at is epoch milliseconds of the latest sighting.
CREATE TABLE IF NOT EXISTS seen_videos (
    video_id TEXT PRIMARY KEY NOT NULL,
    seen_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_seen_videos_seen_at ON seen_videos (seen_at);
