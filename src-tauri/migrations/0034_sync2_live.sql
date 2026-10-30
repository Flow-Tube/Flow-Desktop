-- FLOW-SYNC/2 live messages (spec/live.md, Live messages): this device's counter, which never
-- repeats, the highest counter accepted from each sender, and what the user allowed each device.
ALTER TABLE sync2_group ADD COLUMN live_seq INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS sync2_live_seen (
    did TEXT PRIMARY KEY,
    seq INTEGER NOT NULL
);

-- `allowed` is 1 for "allow always" and 0 for "decline"; a device with no row is asked.
CREATE TABLE IF NOT EXISTS sync2_consent (
    did TEXT PRIMARY KEY,
    allowed INTEGER NOT NULL
);
