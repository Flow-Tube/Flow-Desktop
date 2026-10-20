//! The device-local stores ranking reads beside the brain: channel categories, channels watched
//! together and watch-time topics. None of them is synced.

use sqlx::SqlitePool;

use crate::db::neuro_stores;
use crate::errors::AppResult;
use crate::flow_neuro::categories::CategoryStore;
use crate::flow_neuro::co_watch::CoWatchStore;
use crate::flow_neuro::content_store::ContentStore;

pub struct SideStores {
    pub categories: CategoryStore,
    pub co_watch: CoWatchStore,
    pub content: ContentStore,
    pool: SqlitePool,
}

impl SideStores {
    pub async fn load(pool: SqlitePool) -> AppResult<Self> {
        Ok(Self {
            categories: CategoryStore::load(pool.clone()).await?,
            co_watch: CoWatchStore::load(pool.clone()).await?,
            content: ContentStore::load(pool.clone()).await?,
            pool,
        })
    }

    pub async fn clear(&self) -> AppResult<()> {
        self.categories.forget();
        self.co_watch.forget();
        self.content.forget();
        neuro_stores::clear_all(&self.pool).await
    }
}
