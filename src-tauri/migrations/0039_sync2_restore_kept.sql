-- The devices the user kept during a restore, as a JSON list, until the others are removed.
ALTER TABLE sync2_group ADD COLUMN restore_kept TEXT;
