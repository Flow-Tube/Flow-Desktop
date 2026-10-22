//! Display text in its several shapes: a plain string, `simpleText`, `content`,
//! or `runs`.

use serde_json::Value;

/// The whole text of `value`, every run joined, or none when it has none.
#[must_use]
pub fn text_of(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }
    if let Some(text) = value["simpleText"].as_str() {
        return Some(text.to_string());
    }
    if let Some(text) = value["content"].as_str() {
        return Some(text.to_string());
    }
    let text: String = value["runs"]
        .as_array()?
        .iter()
        .filter_map(|run| run["text"].as_str().or_else(|| run["content"].as_str()))
        .collect();
    (!text.is_empty()).then_some(text)
}

/// The first `browseEndpoint.browseId` among the runs of `container[field]`.
#[must_use]
pub fn browse_id_in_runs(container: &Value, field: &str) -> Option<String> {
    container[field]["runs"].as_array()?.iter().find_map(|run| {
        run["navigationEndpoint"]["browseEndpoint"]["browseId"]
            .as_str()
            .map(ToOwned::to_owned)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn every_shape() {
        assert_eq!(text_of(&json!("plain")).as_deref(), Some("plain"));
        assert_eq!(
            text_of(&json!({ "simpleText": "simple" })).as_deref(),
            Some("simple")
        );
        assert_eq!(text_of(&json!({ "content": "vm" })).as_deref(), Some("vm"));
        assert_eq!(
            text_of(&json!({ "runs": [{ "text": "197" }, { "text": " watching" }] })).as_deref(),
            Some("197 watching")
        );
        assert_eq!(text_of(&json!({ "runs": [] })), None);
        assert_eq!(text_of(&json!(null)), None);
    }

    #[test]
    fn browse_ids_from_runs() {
        let video = json!({ "ownerText": { "runs": [
            { "text": "Channel", "navigationEndpoint": { "browseEndpoint": { "browseId": "UC1" } } }
        ] } });
        assert_eq!(
            browse_id_in_runs(&video, "ownerText").as_deref(),
            Some("UC1")
        );
        assert_eq!(browse_id_in_runs(&video, "longBylineText"), None);
    }
}
