-- Downloads that have not finished, so they survive a restart and can be retried.
-- `request_json` is the selection the user made, not stream links: links are
-- resolved again when the job runs, because they expire within hours.
CREATE TABLE IF NOT EXISTS download_jobs (
    id TEXT PRIMARY KEY,
    request_json TEXT NOT NULL,
    file_path TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'paused', 'failed')),
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
