-- Listens and loves waiting to reach Last.fm, Libre.fm or ListenBrainz (Flow for Android's
-- ScrobbleStore queues). A listen is queued the moment it counts and leaves once the service
-- accepts it, so quitting or going offline loses nothing. Device-local, never synced or backed up.
-- service: LASTFM, LIBREFM or LISTENBRAINZ. Each service keeps at most 2,000 rows of each kind.
CREATE TABLE IF NOT EXISTS scrobble_queue (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    service       TEXT    NOT NULL,
    artist        TEXT    NOT NULL,
    title         TEXT    NOT NULL,
    album         TEXT    NOT NULL DEFAULT '',
    duration_sec  INTEGER NOT NULL DEFAULT 0,
    timestamp_sec INTEGER NOT NULL,
    from_youtube  INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_scrobble_queue_service ON scrobble_queue (service, id);

-- Likes and unlikes to mirror as loves; Last.fm and Libre.fm only.
CREATE TABLE IF NOT EXISTS scrobble_loves (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    service TEXT    NOT NULL,
    artist  TEXT    NOT NULL,
    title   TEXT    NOT NULL,
    loved   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scrobble_loves_service ON scrobble_loves (service, id);
