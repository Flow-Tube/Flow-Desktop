-- FLOW-SYNC/2 roster entries the user kept when two sides of the roster removed each other
-- (spec/protocol.md, Contested rosters). They never leave this device.
CREATE TABLE IF NOT EXISTS sync2_roster_pins (
    hash TEXT PRIMARY KEY
);
