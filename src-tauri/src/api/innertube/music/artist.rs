//! Artist page extractor (reuses the existing `models::music::ArtistPage`).

use serde_json::Value;

use super::parse::runs::runs_text;
use super::parse::shelves;
use super::parse::thumbnail::thumbnail_url;
use crate::api::innertube::InnertubeClient;
use crate::errors::AppResult;
use crate::models::music::{ArtistItem, ArtistPage, ArtistSection};

impl InnertubeClient {
    /// Fetch an artist page by channel/browse id (`UC…`).
    pub(crate) async fn music_artist_page(&self, browse_id: &str) -> AppResult<ArtistPage> {
        let res = self.music_browse(Some(browse_id), None, None).await?;

        let header = find_artist_header(&res);
        let title = runs_text(&header["title"]).unwrap_or_default();
        let thumbnail = thumbnail_url(header);
        let description =
            runs_text(&header["description"]["musicDescriptionShelfRenderer"]["description"])
                .or_else(|| runs_text(&header["description"]));
        let subscriber_count_text = runs_text(
            &header["subscriptionButton2"]["subscribeButtonRenderer"]
                ["subscriberCountWithSubscribeText"],
        )
        .or_else(|| {
            runs_text(
                &header["subscriptionButton"]["subscribeButtonRenderer"]["longSubscriberCountText"],
            )
        })
        .or_else(|| {
            runs_text(
                &header["subscriptionButton"]["subscribeButtonRenderer"]
                    ["shortSubscriberCountText"],
            )
        });
        let monthly_listener_count = runs_text(&header["monthlyListenerCount"]);

        let mut sections: Vec<ArtistSection> = Vec::new();
        for section in shelves::section_list_contents(&res) {
            if let Some(shelf) = shelves::parse_section(&section) {
                sections.push(ArtistSection {
                    title: shelf.title,
                    items: shelf.items,
                    more_endpoint_browse_id: shelf.browse_id,
                    more_endpoint_params: shelf.params,
                });
            }
        }

        Ok(ArtistPage {
            artist: ArtistItem {
                id: browse_id.to_string(),
                title,
                thumbnail,
                channel_id: Some(browse_id.to_string()),
            },
            sections,
            description,
            subscriber_count_text,
            monthly_listener_count,
            is_subscribed: false,
        })
    }
}

fn find_artist_header(res: &Value) -> &Value {
    for key in [
        "musicImmersiveHeaderRenderer",
        "musicVisualHeaderRenderer",
        "musicHeaderRenderer",
        "musicDetailHeaderRenderer",
        "musicResponsiveHeaderRenderer",
    ] {
        let node = &res["header"][key];
        if !node.is_null() {
            return node;
        }
    }
    &res["header"]
}
