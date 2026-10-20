//! The topics a video read as when it was watched with its description, from Flow for Android's
//! `NeuroContentStore`: feed candidates arrive with bare titles, so a video met again is scored on
//! what it was really about. Keys read under another key spec are dropped on load.

use std::collections::HashMap;
use std::sync::Mutex;

use sqlx::SqlitePool;

use crate::db::neuro_stores::{self, ContentRow};
use crate::errors::AppResult;
use crate::flow_neuro::keyspec::VERSION as KEY_SPEC_VERSION;

const MAX_ENTRIES: usize = 1500;
const TOPICS_PER_ENTRY: usize = 12;

struct Stored {
    topics: HashMap<String, f64>,
    at_ms: i64,
}

/// Watch-time topics per video, resident and written through to SQLite.
pub struct ContentStore {
    pool: SqlitePool,
    vectors: Mutex<HashMap<String, Stored>>,
}

impl ContentStore {
    pub async fn load(pool: SqlitePool) -> AppResult<Self> {
        let vectors = neuro_stores::load_content(&pool)
            .await?
            .into_iter()
            .filter(|row| row.key_spec == i64::from(KEY_SPEC_VERSION))
            .filter_map(|row| {
                let topics = serde_json::from_str(&row.topics).ok()?;
                Some((
                    row.video_id,
                    Stored {
                        topics,
                        at_ms: row.seen_at,
                    },
                ))
            })
            .collect();
        Ok(Self {
            pool,
            vectors: Mutex::new(vectors),
        })
    }

    #[must_use]
    pub fn topics_for(&self, video_id: &str) -> Option<HashMap<String, f64>> {
        self.vectors
            .lock()
            .unwrap()
            .get(video_id)
            .map(|stored| stored.topics.clone())
    }

    /// Keeps the strongest topics of a watched video, the oldest entries giving way.
    pub async fn put(
        &self,
        video_id: &str,
        topics: &HashMap<String, f64>,
        now_ms: i64,
    ) -> AppResult<()> {
        if video_id.trim().is_empty() || topics.is_empty() {
            return Ok(());
        }
        let mut ranked: Vec<(&String, &f64)> = topics.iter().collect();
        ranked.sort_by(|a, b| b.1.total_cmp(a.1).then_with(|| a.0.cmp(b.0)));
        let trimmed: HashMap<String, f64> = ranked
            .into_iter()
            .take(TOPICS_PER_ENTRY)
            .map(|(key, value)| (key.clone(), *value))
            .collect();
        let row = ContentRow {
            video_id: video_id.to_string(),
            topics: serde_json::to_string(&trimmed).unwrap_or_default(),
            key_spec: i64::from(KEY_SPEC_VERSION),
            seen_at: now_ms,
        };
        {
            let mut vectors = self.vectors.lock().unwrap();
            vectors.insert(
                video_id.to_string(),
                Stored {
                    topics: trimmed,
                    at_ms: now_ms,
                },
            );
            if vectors.len() > MAX_ENTRIES {
                let mut by_age: Vec<(String, i64)> = vectors
                    .iter()
                    .map(|(id, stored)| (id.clone(), stored.at_ms))
                    .collect();
                by_age.sort_by_key(|(_, at)| std::cmp::Reverse(*at));
                for (id, _) in by_age.into_iter().skip(MAX_ENTRIES) {
                    vectors.remove(&id);
                }
            }
        }
        neuro_stores::save_content(
            &self.pool,
            &row,
            i64::try_from(MAX_ENTRIES).unwrap_or(i64::MAX),
        )
        .await
    }

    /// Forgets every vector; the caller clears the table.
    pub fn forget(&self) {
        self.vectors.lock().unwrap().clear();
    }
}
