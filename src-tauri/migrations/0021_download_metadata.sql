-- What a download was tagged with, so the library can show it and retag it offline.
-- `cover_path` is Flow's private copy of the cover (in app data), not a file beside the media.
ALTER TABLE downloads ADD COLUMN cover_path TEXT;
ALTER TABLE downloads ADD COLUMN artists_json TEXT;
ALTER TABLE downloads ADD COLUMN album TEXT;
ALTER TABLE downloads ADD COLUMN album_id TEXT;
ALTER TABLE downloads ADD COLUMN album_artist TEXT;
ALTER TABLE downloads ADD COLUMN track_number INTEGER;
ALTER TABLE downloads ADD COLUMN track_total INTEGER;
ALTER TABLE downloads ADD COLUMN release_date TEXT;
ALTER TABLE downloads ADD COLUMN description TEXT;
ALTER TABLE downloads ADD COLUMN channel_id TEXT;
ALTER TABLE downloads ADD COLUMN container TEXT;
ALTER TABLE downloads ADD COLUMN video_codec TEXT;
ALTER TABLE downloads ADD COLUMN chapters_json TEXT;
ALTER TABLE downloads ADD COLUMN sponsorblock_json TEXT;
