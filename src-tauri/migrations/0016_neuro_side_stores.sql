-- Which YouTube categories each channel posts in, learned from every watched video that carries
-- one (Flow for Android's NeuroCategoryStore). Search, related and feed results carry no category,
-- so this is how a candidate gets one without another request. Device-local, never synced.
CREATE TABLE IF NOT EXISTS neuro_channel_categories (
    channel_id TEXT    NOT NULL,
    category   TEXT    NOT NULL,
    count      INTEGER NOT NULL DEFAULT 0,
    seen_at    INTEGER NOT NULL,
    PRIMARY KEY (channel_id, category)
);

CREATE INDEX IF NOT EXISTS idx_neuro_channel_categories_seen
    ON neuro_channel_categories (channel_id, seen_at);

-- Related lists YouTube showed beside videos the viewer really watched or liked: which channels
-- sit next to the viewer's own (Flow for Android's NeuroCoWatchStore). Device-local, never synced.
-- related / names: JSON array of channel ids, JSON object of channel id to name.
CREATE TABLE IF NOT EXISTS neuro_cowatch_sources (
    video_id   TEXT    PRIMARY KEY,
    channel_id TEXT    NOT NULL,
    related    TEXT    NOT NULL,
    names      TEXT    NOT NULL DEFAULT '{}',
    seen_at    INTEGER NOT NULL
);

-- The topic vector a video read as when it was watched with its description, so the same video
-- met again as a bare-title candidate is scored on its real content (NeuroContentStore).
-- topics: JSON object of key to weight, at most 12. key_spec: the key spec the keys were read under.
CREATE TABLE IF NOT EXISTS neuro_content_topics (
    video_id TEXT    PRIMARY KEY,
    topics   TEXT    NOT NULL,
    key_spec INTEGER NOT NULL,
    seen_at  INTEGER NOT NULL
);
