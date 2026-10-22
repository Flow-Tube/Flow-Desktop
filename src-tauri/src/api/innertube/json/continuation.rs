//! Continuation tokens and the item lists continuation responses deliver.
//!
//! The next-page token comes in several shapes, and newer pages use
//! `continuationItemViewModel` instead of `continuationItemRenderer`; reading only
//! the old one cut every playlist off at its first 100 videos.

use serde_json::Value;

/// The next-page token carried by one list item, in any shape it comes in:
/// a `continuationItemRenderer` with a `continuationEndpoint` or a `Show more`
/// `button`, or a `continuationItemViewModel`.
#[must_use]
pub fn continuation_token(item: &Value) -> Option<String> {
    let renderer = &item["continuationItemRenderer"];
    let endpoint = &renderer["continuationEndpoint"];
    [
        &endpoint["continuationCommand"]["token"],
        &renderer["button"]["buttonRenderer"]["command"]["continuationCommand"]["token"],
        &item["continuationItemViewModel"]["continuationCommand"]["innertubeCommand"]
            ["continuationCommand"]["token"],
    ]
    .into_iter()
    .find_map(Value::as_str)
    .or_else(|| {
        endpoint["commandExecutorCommand"]["commands"]
            .as_array()?
            .iter()
            .find_map(|command| command["continuationCommand"]["token"].as_str())
    })
    .filter(|token| !token.is_empty())
    .map(ToOwned::to_owned)
}

/// The last token among `items`, where a page puts its next-page marker.
#[must_use]
pub fn last_continuation_token(items: &[Value]) -> Option<String> {
    items.iter().rev().find_map(continuation_token)
}

/// Every item list a continuation response delivers, from append actions and
/// reload commands under `onResponseReceivedActions`, `onResponseReceivedCommands`
/// and, for watch-page continuations, `onResponseReceivedEndpoints`.
#[must_use]
pub fn continuation_item_lists(response: &Value) -> Vec<&Vec<Value>> {
    [
        "onResponseReceivedActions",
        "onResponseReceivedCommands",
        "onResponseReceivedEndpoints",
    ]
    .into_iter()
    .filter_map(|key| response[key].as_array())
    .flatten()
    .filter_map(|action| {
        action["appendContinuationItemsAction"]["continuationItems"]
            .as_array()
            .or_else(|| action["reloadContinuationItemsCommand"]["continuationItems"].as_array())
    })
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_every_token_shape() {
        let renderer = json!({ "continuationItemRenderer": { "continuationEndpoint": {
            "continuationCommand": { "token": "A" } } } });
        let button = json!({ "continuationItemRenderer": { "button": { "buttonRenderer": {
            "command": { "continuationCommand": { "token": "B" } } } } } });
        let view_model = json!({ "continuationItemViewModel": { "continuationCommand": {
            "innertubeCommand": { "continuationCommand": { "token": "C" } } } } });
        let executor = json!({ "continuationItemRenderer": { "continuationEndpoint": {
            "commandExecutorCommand": { "commands": [
                { "clickTrackingParams": "x" },
                { "continuationCommand": { "token": "D" } }
            ] } } } });
        assert_eq!(continuation_token(&renderer).as_deref(), Some("A"));
        assert_eq!(continuation_token(&button).as_deref(), Some("B"));
        assert_eq!(continuation_token(&view_model).as_deref(), Some("C"));
        assert_eq!(continuation_token(&executor).as_deref(), Some("D"));
        assert_eq!(continuation_token(&json!({ "lockupViewModel": {} })), None);
    }

    #[test]
    fn last_token_wins() {
        let items = vec![
            json!({ "lockupViewModel": {} }),
            json!({ "continuationItemViewModel": { "continuationCommand": {
                "innertubeCommand": { "continuationCommand": { "token": "NEXT" } } } } }),
        ];
        assert_eq!(last_continuation_token(&items).as_deref(), Some("NEXT"));
    }

    #[test]
    fn lists_come_from_actions_and_commands() {
        let response = json!({
            "onResponseReceivedActions": [
                { "appendContinuationItemsAction": { "continuationItems": [{ "a": 1 }] } }
            ],
            "onResponseReceivedCommands": [
                { "reloadContinuationItemsCommand": { "continuationItems": [{ "b": 1 }, { "c": 1 }] } }
            ]
        });
        let lists = continuation_item_lists(&response);
        assert_eq!(lists.len(), 2);
        assert_eq!(lists[1].len(), 2);
    }
}
