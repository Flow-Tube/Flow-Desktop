//! The content of live messages (spec/live.md, Live messages): presence, what a device plays, a
//! handoff, a remote command, and the answer to either.

use serde::{Deserialize, Serialize};

/// A queue travels with at most this many videos.
pub const QUEUE_LIMIT: usize = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Ability {
    Play,
    Remote,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DeviceKind {
    Phone,
    Tablet,
    Tv,
    Desktop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlayState {
    Playing,
    Paused,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Command {
    Play,
    Pause,
    Seek,
    Next,
    Previous,
    Volume,
    Queue,
}

/// What a device plays. `video` is `None` when nothing is loaded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Now {
    pub video: Option<String>,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub by: String,
    #[serde(default)]
    pub music: bool,
    #[serde(default)]
    pub link: Option<String>,
    #[serde(default)]
    pub pos: u64,
    #[serde(default)]
    pub dur: u64,
    pub state: PlayState,
    #[serde(default)]
    pub vol: u8,
    #[serde(default)]
    pub queue: Vec<String>,
    #[serde(default)]
    pub index: usize,
}

/// A whole playback session handed to device `to`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Play {
    pub to: String,
    pub video: String,
    pub pos: u64,
    pub music: bool,
    pub link: Option<String>,
    pub queue: Vec<String>,
    pub index: usize,
    pub state: PlayState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Cmd {
    pub to: String,
    pub cmd: Command,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pos: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vol: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub queue: Option<Vec<String>>,
}

/// The outcome of the `play` or `cmd` with counter `reference`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Answer {
    pub to: String,
    #[serde(rename = "ref")]
    pub reference: u64,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum LiveMessage {
    Presence { can: Vec<Ability>, kind: DeviceKind },
    Now(Now),
    Play(Play),
    Cmd(Cmd),
    Result(Answer),
}

fn fits(queue: &[String], index: usize) -> bool {
    queue.len() <= QUEUE_LIMIT && (queue.is_empty() || index < queue.len())
}

impl LiveMessage {
    /// Whether the fields are within the limits the spec sets.
    pub fn is_valid(&self) -> bool {
        match self {
            Self::Presence { .. } | Self::Result(_) => true,
            Self::Now(now) => now.vol <= 100 && fits(&now.queue, now.index),
            Self::Play(play) => fits(&play.queue, play.index),
            Self::Cmd(cmd) => {
                cmd.vol.is_none_or(|vol| vol <= 100)
                    && cmd
                        .queue
                        .as_ref()
                        .is_none_or(|queue| queue.len() <= QUEUE_LIMIT)
            }
        }
    }

    /// The device a `play`, `cmd` or `result` is for; `None` for messages to everyone.
    pub fn to(&self) -> Option<&str> {
        match self {
            Self::Presence { .. } | Self::Now(_) => None,
            Self::Play(Play { to, .. })
            | Self::Cmd(Cmd { to, .. })
            | Self::Result(Answer { to, .. }) => Some(to),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::canonical::to_canonical_json;

    #[test]
    fn messages_read_and_write_the_spec_fields() {
        let result: LiveMessage = serde_json::from_str(
            r#"{"type":"result","to":"ab","ref":7,"ok":false,"reason":"declined"}"#,
        )
        .unwrap();
        assert_eq!(result.to(), Some("ab"));
        assert_eq!(
            to_canonical_json(&result),
            br#"{"ok":false,"reason":"declined","ref":7,"to":"ab","type":"result"}"#
        );
        let presence = LiveMessage::Presence {
            can: vec![Ability::Play, Ability::Remote],
            kind: DeviceKind::Desktop,
        };
        assert_eq!(
            to_canonical_json(&presence),
            br#"{"can":["play","remote"],"kind":"desktop","type":"presence"}"#
        );
        let stopped: LiveMessage =
            serde_json::from_str(r#"{"type":"now","video":null,"state":"paused"}"#).unwrap();
        assert!(stopped.is_valid());
    }

    #[test]
    fn a_queue_over_the_limit_or_an_index_past_it_is_refused() {
        let play = |queue: usize, index| {
            LiveMessage::Play(Play {
                to: "ab".into(),
                video: "v".into(),
                pos: 0,
                music: false,
                link: None,
                queue: vec!["v".into(); queue],
                index,
                state: PlayState::Playing,
            })
        };
        assert!(play(50, 49).is_valid());
        assert!(!play(51, 0).is_valid());
        assert!(!play(3, 3).is_valid());
    }
}
