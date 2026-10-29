-- FLOW-SYNC/2 garbage collection: every device's latest ack, the snapshot manifests seen, the links
-- batches name (each needs a snapshot), and how far each collectable log has been deleted.
CREATE TABLE IF NOT EXISTS sync2_acks (
    did TEXT PRIMARY KEY,
    vv TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync2_manifests (
    did TEXT NOT NULL,
    seq INTEGER NOT NULL,
    manifest TEXT NOT NULL,
    PRIMARY KEY (did, seq)
);

-- `link` is the JSON of the link id, `null` for the profiles collection.
CREATE TABLE IF NOT EXISTS sync2_links (
    link TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS sync2_collected (
    did TEXT PRIMARY KEY,
    through INTEGER NOT NULL
);
