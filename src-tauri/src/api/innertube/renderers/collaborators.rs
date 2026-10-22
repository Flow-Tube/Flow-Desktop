//! The channels behind a collaboration, read from the "Collaborators" dialog
//! that is inlined under a collaboration's byline, avatar stack and subscribe
//! button. A collaboration's byline opens that dialog instead of linking a
//! channel, so it is the only place the card names its channels at all.

use serde_json::Value;

use crate::api::innertube::json::text::text_of;
use crate::api::innertube::json::thumbnail::{largest_url, normalize_youtube_image_url};
use crate::models::video::Collaborator;

/// The collaborators listed by the first dialog under `node`, or none unless it
/// names at least two channels.
///
/// Call it on the node that opens the dialog (a byline run, an avatar stack, the
/// watch page owner's endpoint), never on a whole renderer: a renderer's menu
/// carries unrelated dialogs of the same shape.
#[must_use]
pub fn collaborators_in(node: &Value) -> Vec<Collaborator> {
    let Some(dialog) = first_show_dialog_command(node) else {
        return Vec::new();
    };
    let items = dialog["panelLoadingStrategy"]["inlineContent"]["dialogViewModel"]["customContent"]
        ["listViewModel"]["listItems"]
        .as_array();
    let mut collaborators: Vec<Collaborator> = Vec::new();
    for item in items.into_iter().flatten() {
        let Some(collaborator) = collaborator(&item["listItemViewModel"]) else {
            continue;
        };
        if !collaborators
            .iter()
            .any(|c| c.channel_id == collaborator.channel_id)
        {
            collaborators.push(collaborator);
        }
    }
    if collaborators.len() < 2 {
        collaborators.clear();
    }
    collaborators
}

fn first_show_dialog_command(node: &Value) -> Option<&Value> {
    match node {
        Value::Object(map) => map
            .get("showDialogCommand")
            .or_else(|| map.values().find_map(first_show_dialog_command)),
        Value::Array(items) => items.iter().find_map(first_show_dialog_command),
        _ => None,
    }
}

fn first_channel_browse_id(node: &Value) -> Option<String> {
    match node {
        Value::Object(map) => map
            .get("browseEndpoint")
            .and_then(|endpoint| endpoint["browseId"].as_str())
            .filter(|id| id.starts_with("UC"))
            .map(ToOwned::to_owned)
            .or_else(|| map.values().find_map(first_channel_browse_id)),
        Value::Array(items) => items.iter().find_map(first_channel_browse_id),
        _ => None,
    }
}

fn without_bidi_marks(text: &str) -> String {
    text.chars()
        .filter(|c| !matches!(c, '\u{200e}' | '\u{200f}' | '\u{2066}'..='\u{2069}'))
        .collect::<String>()
        .trim()
        .to_string()
}

fn collaborator(item: &Value) -> Option<Collaborator> {
    let channel_id = first_channel_browse_id(&item["rendererContext"])
        .or_else(|| first_channel_browse_id(&item["title"]))?;
    let name = text_of(&item["title"])
        .map(|name| without_bidi_marks(&name))
        .filter(|name| !name.is_empty())?;
    let subtitle = text_of(&item["subtitle"]).map(|text| without_bidi_marks(&text));
    // "@handle • 21.3M subscribers": the count follows the bullet in every locale.
    let (handle, subscriber_count_text) =
        match subtitle.as_deref().and_then(|text| text.split_once('•')) {
            Some((handle, count)) => (handle.trim(), count.trim()),
            None => (subtitle.as_deref().unwrap_or_default(), ""),
        };
    Some(Collaborator {
        channel_id,
        name,
        avatar_url: largest_url(&item["leadingAccessory"]["avatarViewModel"]["image"]["sources"])
            .map(|url| normalize_youtube_image_url(&url)),
        handle: Some(handle.to_string()).filter(|handle| handle.starts_with('@')),
        subscriber_count_text: Some(subscriber_count_text.to_string())
            .filter(|text| !text.is_empty()),
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::{Value, json};

    pub(crate) fn dialog(channels: &[(&str, &str)]) -> Value {
        let items: Vec<Value> = channels
            .iter()
            .map(|(id, name)| {
                json!({ "listItemViewModel": {
                    "title": { "content": format!("\u{200e}{name}") },
                    "subtitle": { "content": format!("@{name} • 1.2M subscribers") },
                    "leadingAccessory": { "avatarViewModel": { "image": { "sources": [
                        { "url": format!("https://yt3.ggpht.com/{id}=s88"), "width": 88, "height": 88 }
                    ] } } },
                    "rendererContext": { "commandContext": { "onTap": { "innertubeCommand": {
                        "browseEndpoint": { "browseId": id }
                    } } } }
                } })
            })
            .collect();
        json!({ "showDialogCommand": { "panelLoadingStrategy": { "inlineContent": {
            "dialogViewModel": { "customContent": { "listViewModel": { "listItems": items } } }
        } } } })
    }

    #[test]
    fn reads_every_listed_channel() {
        let node = json!({ "navigationEndpoint": dialog(&[("UC1", "CNET"), ("UC2", "Engadget")]) });
        let collaborators = collaborators_in(&node);
        assert_eq!(collaborators.len(), 2);
        assert_eq!(collaborators[0].channel_id, "UC1");
        assert_eq!(collaborators[0].name, "CNET");
        assert_eq!(collaborators[0].handle.as_deref(), Some("@CNET"));
        assert_eq!(
            collaborators[0].subscriber_count_text.as_deref(),
            Some("1.2M subscribers")
        );
        assert_eq!(
            collaborators[1].avatar_url.as_deref(),
            Some("https://yt3.ggpht.com/UC2=s512")
        );
    }

    #[test]
    fn one_channel_is_not_a_collaboration() {
        assert!(collaborators_in(&dialog(&[("UC1", "Solo")])).is_empty());
        assert!(collaborators_in(&json!({ "browseEndpoint": { "browseId": "UC1" } })).is_empty());
    }
}
