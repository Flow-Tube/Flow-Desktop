-- Home feed state the backend keeps between loads (Flow for Android's HomeFeedCacheRepository and
-- channel memory / neighbour stores). Device-local, never synced.
--
-- home_feed_cache buckets:
--   LAST_FEED  the feed as last shown, in order, with each card's origin (60 cards, 8 h)
--   RESERVE    ranked candidates a page did not use, served first by load-more (200, 12 h)
--   RELATED    one seed's related list (20 per seed, 50 seeds, 90 min)
-- video: the card as JSON (VideoSummary plus its publish time).
-- origin: why the card is on Home, as JSON; NULL when unknown.
CREATE TABLE IF NOT EXISTS home_feed_cache (
    bucket      TEXT    NOT NULL,
    seed_id     TEXT    NOT NULL DEFAULT '',
    video_id    TEXT    NOT NULL,
    source      TEXT    NOT NULL,
    video       TEXT    NOT NULL,
    origin      TEXT,
    order_index INTEGER NOT NULL,
    cached_at   INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    PRIMARY KEY (bucket, seed_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_home_feed_cache_expiry ON home_feed_cache (expires_at);

-- Channels the viewer keeps watching without subscribing: when their uploads were last fetched,
-- what they were, and the viewer's verdicts on the channel.
-- uploads: JSON array of cards from the last two weeks.
CREATE TABLE IF NOT EXISTS home_channel_memory (
    channel_id      TEXT    PRIMARY KEY,
    name            TEXT    NOT NULL DEFAULT '',
    last_fetched_at INTEGER NOT NULL DEFAULT 0,
    uploads         TEXT    NOT NULL DEFAULT '[]',
    rejected_at     INTEGER NOT NULL DEFAULT 0,
    forgotten_at    INTEGER NOT NULL DEFAULT 0
);

-- Channels next to the viewer's own (from co-watch): their latest uploads, and how often they
-- were shown without a watch.
CREATE TABLE IF NOT EXISTS home_neighbour_channels (
    channel_id  TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL DEFAULT '',
    fetched_at  INTEGER NOT NULL DEFAULT 0,
    uploads     TEXT    NOT NULL DEFAULT '[]',
    impressions INTEGER NOT NULL DEFAULT 0,
    dropped     INTEGER NOT NULL DEFAULT 0
);

-- The latest uploads of followed channels, from their RSS feeds and Videos tabs, with real publish
-- times (Flow for Android's subscription feed store). Home reads it for its subscription lanes
-- without a network call. card: the upload as JSON; RSS rows have no length until a Videos tab
-- or the player fills one in.
CREATE TABLE IF NOT EXISTS subscription_uploads (
    video_id     TEXT    PRIMARY KEY,
    channel_id   TEXT    NOT NULL,
    published_at INTEGER NOT NULL,
    card         TEXT    NOT NULL,
    updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subscription_uploads_published
    ON subscription_uploads (published_at);
