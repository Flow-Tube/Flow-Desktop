-- FLOW-SYNC/2: the group this device belongs to, the roster it verified, and how far it has read
-- each other device's log. Keys stay in the keychain or are unwrapped again from the store.
CREATE TABLE IF NOT EXISTS sync2_group (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    group_id TEXT NOT NULL,
    store_url TEXT NOT NULL,
    instance TEXT,
    link TEXT NOT NULL,
    own_seq INTEGER NOT NULL DEFAULT 0,
    own_prev TEXT NOT NULL,
    cursor INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sync2_roster (
    seq INTEGER PRIMARY KEY,
    entry TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync2_streams (
    did TEXT PRIMARY KEY,
    seq INTEGER NOT NULL,
    hash TEXT NOT NULL
);
