-- How far a restore's read got when it hit this device's limits, as JSON, until it reaches the end.
ALTER TABLE sync2_group ADD COLUMN restore_read TEXT;
