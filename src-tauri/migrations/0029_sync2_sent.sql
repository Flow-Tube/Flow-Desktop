-- FLOW-SYNC/2: the hash of each record as last uploaded or received, so a device sends only what
-- changed, and when, so the brains go out at most every few hours.
CREATE TABLE IF NOT EXISTS sync2_sent (
    collection TEXT NOT NULL,
    record_key TEXT NOT NULL,
    hash TEXT NOT NULL,
    sent_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (collection, record_key)
);
