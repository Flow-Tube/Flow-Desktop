-- How much louder than YouTube's target a downloaded song plays, so it is normalized offline too.
ALTER TABLE downloads ADD COLUMN loudness_db REAL;
