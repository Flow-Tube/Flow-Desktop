use serde::Deserialize;

use crate::flow_neuro::signals::InteractionType;

/// A session that reached this share of the video is a watch.
pub const WATCHED_SHARE: f32 = 0.20;
/// A shorter session counts as a skip only after this much playback; less is a misclick.
pub const SKIP_MIN_PLAYED_SECONDS: f64 = 10.0;
/// How long an ended session waits for the same video to come back (a pop-out hand-off, a
/// remount) before its outcome is final.
pub const END_GRACE_SECONDS: u64 = 15;

/// What the player reports about the video it is playing.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchReport {
    pub video_id: String,
    pub title: String,
    pub channel_name: String,
    pub channel_id: String,
    pub description: Option<String>,
    pub is_live: bool,
    /// Playback position in seconds.
    pub position: f64,
    /// Media length in seconds, 0 while unknown.
    pub duration: f64,
    /// Seconds played since the previous report, seeks excluded.
    pub played_delta: f64,
}

/// One viewing of one video, however many reports, windows or remounts it spans.
#[derive(Debug, Clone)]
pub struct WatchSession {
    pub report: WatchReport,
    pub generation: u64,
    pub ended: bool,
    start_position: f64,
    furthest: f64,
    played_seconds: f64,
}

/// The single event a finished session teaches.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WatchVerdict {
    pub interaction: InteractionType,
    pub percent_watched: f32,
}

impl WatchSession {
    pub fn start(report: WatchReport, generation: u64) -> Self {
        let mut session = Self {
            report: report.clone(),
            generation,
            ended: false,
            start_position: (report.position - report.played_delta.max(0.0)).max(0.0),
            furthest: 0.0,
            played_seconds: 0.0,
        };
        session.absorb(report);
        session
    }

    /// Folds a later report into the session. Details that arrive late (a description, the
    /// channel id) replace the empty ones the session started with.
    pub fn absorb(&mut self, report: WatchReport) {
        self.played_seconds += report.played_delta.max(0.0);
        self.furthest = self.furthest.max(report.position);
        let description = report
            .description
            .clone()
            .filter(|text| !text.is_empty())
            .or_else(|| self.report.description.take());
        let duration = if report.duration > 0.0 {
            report.duration
        } else {
            self.report.duration
        };
        let channel_id = if report.channel_id.is_empty() {
            std::mem::take(&mut self.report.channel_id)
        } else {
            report.channel_id.clone()
        };
        self.report = WatchReport {
            channel_id,
            description,
            duration,
            ..report
        };
    }

    /// How far the viewer got, by position but never past what they actually played, so a
    /// seek to the end is not a full watch.
    #[allow(clippy::cast_possible_truncation)]
    pub fn percent_watched(&self) -> f32 {
        if self.report.duration <= 0.0 {
            return 0.0;
        }
        let reached = self.furthest.min(self.start_position + self.played_seconds);
        (reached / self.report.duration).clamp(0.0, 1.0) as f32
    }

    pub fn verdict(&self) -> Option<WatchVerdict> {
        let percent_watched = self.percent_watched();
        let interaction = if percent_watched >= WATCHED_SHARE {
            InteractionType::Watched
        } else if self.played_seconds >= SKIP_MIN_PLAYED_SECONDS {
            InteractionType::Skipped
        } else {
            return None;
        };
        Some(WatchVerdict {
            interaction,
            percent_watched,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn report(position: f64, played_delta: f64) -> WatchReport {
        WatchReport {
            video_id: "v1".into(),
            title: "A title".into(),
            channel_name: "Channel".into(),
            channel_id: String::new(),
            description: None,
            is_live: false,
            position,
            duration: 600.0,
            played_delta,
        }
    }

    fn session_of(reports: &[(f64, f64)]) -> WatchSession {
        let mut session = WatchSession::start(report(reports[0].0, reports[0].1), 1);
        for &(position, played) in &reports[1..] {
            session.absorb(report(position, played));
        }
        session
    }

    #[test]
    fn a_misclick_teaches_nothing() {
        assert_eq!(session_of(&[(3.0, 3.0), (6.0, 3.0)]).verdict(), None);
    }

    #[test]
    fn leaving_early_after_ten_seconds_is_a_skip() {
        let verdict = session_of(&[(5.0, 5.0), (12.0, 7.0)]).verdict().unwrap();
        assert_eq!(verdict.interaction, InteractionType::Skipped);
    }

    #[test]
    fn a_fifth_of_the_video_is_a_watch() {
        let reports: Vec<(f64, f64)> = (1..=25).map(|i| (f64::from(i) * 5.0, 5.0)).collect();
        let verdict = session_of(&reports).verdict().unwrap();
        assert_eq!(verdict.interaction, InteractionType::Watched);
        assert!((verdict.percent_watched - 125.0 / 600.0).abs() < 1e-4);
    }

    #[test]
    fn seeking_to_the_end_is_not_a_full_watch() {
        let verdict = session_of(&[(5.0, 5.0), (12.0, 7.0), (590.0, 0.0)])
            .verdict()
            .unwrap();
        assert_eq!(verdict.interaction, InteractionType::Skipped);
    }

    #[test]
    fn a_resumed_video_counts_from_where_it_resumed() {
        let verdict = session_of(&[(300.0, 0.0), (330.0, 30.0)])
            .verdict()
            .unwrap();
        assert_eq!(verdict.interaction, InteractionType::Watched);
        assert!((verdict.percent_watched - 0.55).abs() < 1e-4);
    }

    #[test]
    fn late_details_fill_the_session() {
        let mut session = session_of(&[(5.0, 5.0)]);
        let mut late = report(10.0, 5.0);
        late.channel_id = "UC1".into();
        late.description = Some("about it".into());
        session.absorb(late);
        session.absorb(report(15.0, 5.0));
        assert_eq!(session.report.channel_id, "UC1");
        assert_eq!(session.report.description.as_deref(), Some("about it"));
    }
}
