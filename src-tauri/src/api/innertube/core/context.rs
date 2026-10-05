use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients;

impl InnertubeClient {
    pub async fn fetch_visitor_data(&self) -> Option<String> {
        if let Ok(guard) = self.visitor_data.read() {
            if let Some(existing) = guard.as_ref().filter(|value| !value.is_empty()) {
                return Some(existing.clone());
            }
        }

        let mut payload = serde_json::json!({});
        if let Ok(res) = self
            .post_innertube_for_playback("visitor_id", &clients::WEB, &mut payload)
            .await
        {
            if let Some(vd) = res["responseContext"]["visitorData"].as_str() {
                if let Ok(mut guard) = self.visitor_data.write() {
                    *guard = Some(vd.to_string());
                }
                return Some(vd.to_string());
            }
        }
        None
    }

    /// Drop the cached visitor identity and issue a new one.
    ///
    /// A bot wall on a request that carried `visitorData` means that identity is
    /// no longer trusted; every later request under it would be walled too.
    pub async fn refresh_visitor_data(&self) -> Option<String> {
        if let Ok(mut guard) = self.visitor_data.write() {
            *guard = None;
        }
        self.fetch_visitor_data().await
    }
}
