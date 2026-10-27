-- Videos that failed to play for a reason that belongs to the video (members-only, paid, private,
-- age-restricted, blocked in this country, terminated channel), newest first, at most 1,000.
-- A video leaves the list as soon as it plays. Home leaves these out; Subscriptions does when the
-- viewer turns on "Hide videos that can't play". Device-local, never synced or backed up.
-- reason is the error kind the player showed; marked_at is epoch milliseconds.
CREATE TABLE IF NOT EXISTS unplayable_videos (
    video_id  TEXT PRIMARY KEY NOT NULL,
    reason    TEXT NOT NULL,
    marked_at INTEGER NOT NULL
);
