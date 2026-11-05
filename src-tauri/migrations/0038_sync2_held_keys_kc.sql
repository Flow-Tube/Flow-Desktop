-- Wraps and chain boxes are held per epoch commitment, so two entries that start the same epoch
-- number keep theirs apart. Groups from before this format no longer open, so nothing is kept.
DROP TABLE IF EXISTS sync2_held_keys;
CREATE TABLE sync2_held_keys (
    epoch INTEGER NOT NULL,
    kc TEXT NOT NULL,
    name TEXT NOT NULL,
    bytes BLOB NOT NULL,
    PRIMARY KEY (epoch, kc, name)
);
