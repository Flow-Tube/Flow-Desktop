use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients;
use crate::api::innertube::identity::visitor::Reroll;
use crate::api::innertube::transport::request::{Host, RequestSpec};
use crate::api::innertube::transport::send::send;

impl InnertubeClient {
    /// The visitor identity requests carry, minting one when there is none.
    pub async fn fetch_visitor_data(&self) -> Option<String> {
        self.identity.ensure(|| self.mint_visitor_data()).await
    }

    /// A new identity after `walled` hit a bot wall, or none when the re-roll
    /// budget is spent or minting failed. Callers retry only with a new one.
    pub async fn refresh_visitor_data(&self, walled: Option<&str>) -> Option<String> {
        match self
            .identity
            .reroll(walled, || self.mint_visitor_data())
            .await
        {
            Reroll::Fresh(value) => Some(value),
            Reroll::BudgetSpent => {
                tracing::info!("Bot wall again within the re-roll budget; keeping the identity");
                None
            }
            Reroll::Failed => None,
        }
    }

    /// Forget the identity in use, for the Diagnostics reset.
    pub fn reset_visitor_identity(&self) {
        self.identity.forget();
    }

    async fn mint_visitor_data(&self) -> Option<String> {
        let spec = RequestSpec {
            host: Host::Www,
            endpoint: "visitor_id",
            client: &clients::WEB,
            referer: None,
            extra_query: None,
        };
        let payload = serde_json::json!({ "context": clients::WEB.context(None, None) });
        match send(&self.playback_client, &spec, &payload, None).await {
            Ok(response) => response["responseContext"]["visitorData"]
                .as_str()
                .map(ToOwned::to_owned),
            Err(error) => {
                tracing::warn!(%error, "could not mint a visitor identity");
                None
            }
        }
    }
}
