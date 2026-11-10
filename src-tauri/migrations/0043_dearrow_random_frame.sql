-- A frame for videos with no DeArrow thumbnail. Rows cached before this know nothing about it.
DELETE FROM dearrow_cache;
ALTER TABLE dearrow_cache ADD COLUMN random_frame_url TEXT;
