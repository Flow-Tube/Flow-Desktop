-- The recap ledger: one calendar month of watching or listening per row, as JSON. It stays on this
-- device apart from master backups, and is never a sync collection. Video and music keep separate
-- rows. `estimated` marks a month that includes a rough fold of the watch history from before the
-- ledger started.
CREATE TABLE IF NOT EXISTS recap_months (
    source TEXT NOT NULL,
    month TEXT NOT NULL,
    record TEXT NOT NULL,
    estimated INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (source, month)
);

-- Channels and artists already met, so only a first ever view or play counts as a discovery.
CREATE TABLE IF NOT EXISTS recap_known (
    source TEXT NOT NULL,
    key TEXT NOT NULL,
    PRIMARY KEY (source, key)
);

-- One row once the ledger has started: when, in Unix milliseconds. Before that moment it can only
-- hold estimates.
CREATE TABLE IF NOT EXISTS recap_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    started_at INTEGER NOT NULL
);
