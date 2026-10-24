-- The music queue as the player last left it, so a restart reopens on the same song (Flow for
-- Android's QueuePersistence). One row. state: JSON written and read by the player (queue, index,
-- position, source, shuffle order, radio tracks). Device-local, never synced.
CREATE TABLE IF NOT EXISTS music_queue_state (
    id       INTEGER PRIMARY KEY CHECK (id = 1),
    state    TEXT    NOT NULL,
    saved_at INTEGER NOT NULL
);

-- Where long tracks (ten minutes or more: mixes, podcasts, episodes) were left, so they resume
-- there (Android's MusicResumeTracker). Device-local, never synced.
CREATE TABLE IF NOT EXISTS music_resume_positions (
    video_id         TEXT    PRIMARY KEY,
    position_seconds REAL    NOT NULL,
    duration_seconds REAL    NOT NULL,
    updated_at       INTEGER NOT NULL
);
