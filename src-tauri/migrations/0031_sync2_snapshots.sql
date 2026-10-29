-- FLOW-SYNC/2: when this device last wrote a snapshot of each link and how many bytes of batches
-- it has merged since, which decide when it writes the next one.
CREATE TABLE IF NOT EXISTS sync2_snapshots (
    link TEXT PRIMARY KEY,
    written_ms INTEGER NOT NULL,
    merged_bytes INTEGER NOT NULL DEFAULT 0
);
