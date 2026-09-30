CREATE TABLE IF NOT EXISTS music_content_cache (
    source_kind TEXT NOT NULL,
    source_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    PRIMARY KEY (source_kind, source_id)
);

CREATE TABLE IF NOT EXISTS music_content_entities (
    entity_kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (entity_kind, entity_id)
);

CREATE TABLE IF NOT EXISTS music_content_edges (
    source_kind TEXT NOT NULL,
    source_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    target_kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (source_kind, source_id, relation, target_kind, target_id)
);

CREATE INDEX IF NOT EXISTS idx_music_content_edges_source
    ON music_content_edges (source_kind, source_id, position);
CREATE INDEX IF NOT EXISTS idx_music_content_edges_target
    ON music_content_edges (target_kind, target_id);
