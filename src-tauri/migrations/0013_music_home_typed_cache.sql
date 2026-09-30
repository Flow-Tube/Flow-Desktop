CREATE TABLE IF NOT EXISTS music_home_typed_cache (
    locale_stamp TEXT PRIMARY KEY,
    page_json TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
);
