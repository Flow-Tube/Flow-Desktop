-- FLOW-SYNC/2 groups that live on their devices (spec/live.md, LAN groups): what kind of store a
-- group uses, and everything this device holds and serves to the others on the LAN.
ALTER TABLE sync2_group ADD COLUMN kind TEXT NOT NULL DEFAULT 'server';

-- Every roster entry seen, fork candidates included, under its store name.
CREATE TABLE IF NOT EXISTS sync2_held_roster (
    name TEXT PRIMARY KEY,
    seq INTEGER NOT NULL,
    entry TEXT NOT NULL
);

-- Wraps by member id, and chain boxes under `chain`.
CREATE TABLE IF NOT EXISTS sync2_held_keys (
    epoch INTEGER NOT NULL,
    name TEXT NOT NULL,
    bytes BLOB NOT NULL,
    PRIMARY KEY (epoch, name)
);

-- Log objects and blobs; `id` is the change cursor.
CREATE TABLE IF NOT EXISTS sync2_held_objects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    bytes BLOB NOT NULL
);
