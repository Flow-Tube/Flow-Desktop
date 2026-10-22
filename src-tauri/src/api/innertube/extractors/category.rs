//! A video's category ("Gaming", "Education"), which the recommendation engine
//! clusters by. The clients that serve streams return no microformat and the
//! watch answer has no category, so it costs one small `MWEB` player request,
//! asked without a signature timestamp: the answer is unplayable and carries no
//! streams, about 8 KB (Flow for Android's `videoCategory`).

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients;
use crate::api::innertube::core::player_requests::PlayerFlights;
use crate::api::innertube::transport::request::Host;
use crate::errors::AppResult;

// A category never changes, so every one asked this session is kept.
const CAPACITY: usize = 1024;

fn cache() -> &'static Mutex<HashMap<String, Option<String>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

impl InnertubeClient {
    pub async fn get_video_category(&self, video_id: &str) -> AppResult<Option<String>> {
        static FLIGHTS: OnceLock<PlayerFlights<Option<String>>> = OnceLock::new();
        if let Some(category) = cache()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(video_id)
        {
            return Ok(category.clone());
        }
        let flight = FLIGHTS
            .get_or_init(PlayerFlights::default)
            .for_video(video_id);
        let category = flight
            .get_or_init(|| async {
                let mut payload = serde_json::json!({
                    "videoId": video_id,
                    "contentCheckOk": true,
                    "racyCheckOk": true,
                });
                // A failed request is not remembered, so a later watch asks again.
                let response = self
                    .post_via(
                        &self.client,
                        Host::Www,
                        "player",
                        &clients::MWEB,
                        &mut payload,
                        None,
                        None,
                    )
                    .await
                    .ok()?;
                let category = response["microformat"]["playerMicroformatRenderer"]["category"]
                    .as_str()
                    .filter(|category| !category.is_empty())
                    .map(ToOwned::to_owned);
                let mut cache = cache()
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                if cache.len() >= CAPACITY {
                    cache.clear();
                }
                cache.insert(video_id.to_string(), category.clone());
                category
            })
            .await
            .clone();
        Ok(category)
    }
}
