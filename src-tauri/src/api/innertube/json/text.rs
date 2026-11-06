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

/// Strips "Go to channel" or localized prefixes from accessibility labels (e.g. "Go to channel Maddock Films" -> "Maddock Films").
#[must_use]
pub fn extract_channel_from_a11y_label(label: &str) -> Option<&str> {
    const PREFIXES: &[&str] = &[
        "Go to channel ",
        "Go to ",
        "Channel ",
        "Aller sur la chaîne ",
        "Accéder à la chaîne ",
        "Ir al canal ",
        "Ir para o canal ",
        "Zum Kanal ",
        "Kanal aufrufen: ",
        "Kanal aufrufen ",
        "Vai al canale ",
        "Ga naar kanaal ",
        "Перейти на канал ",
        "Перейти к каналу ",
        "Przejdź do kanału ",
        "Kanalına git: ",
        "Kanalına git ",
        "채널로 이동: ",
        "채널로 이동 ",
        "チャンネルに移動: ",
        "チャンネルに移動 ",
        "前往頻道: ",
        "前往頻道 ",
        "前往频道: ",
        "前往频道 ",
    ];
    let mut candidate = label.trim();
    for prefix in PREFIXES {
        if let Some(stripped) = candidate.strip_prefix(prefix) {
            candidate = stripped.trim();
            break;
        }
    }
    if !candidate.is_empty()
        && !crate::api::innertube::json::count::is_view_or_stream_count(candidate)
    {
        Some(candidate)
    } else {
        None
    }
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
