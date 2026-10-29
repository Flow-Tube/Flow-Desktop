-- FLOW-SYNC/2 garbage collection: every device's latest ack, the snapshot manifests seen, and how
-- far each collectable log has been deleted.
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

CREATE TABLE IF NOT EXISTS sync2_collected (
    did TEXT PRIMARY KEY,
    through INTEGER NOT NULL
);
