-- FLOW-SYNC/2 server groups that also sync over the LAN (spec/live.md, LAN groups: "Groups on a
-- store sync the same way"): objects this device wrote while the server was out of reach, kept
-- with the others it holds and uploaded in order once the server answers again.
CREATE TABLE IF NOT EXISTS sync2_pending (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE
);
