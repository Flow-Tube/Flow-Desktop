use serde::{Deserialize, Serialize};

use crate::models::video::VideoSummary;

/// A page to browse: a destination, one of its tabs, or a shelf's full grid.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExploreTarget {
    pub browse_id: String,
    pub params: Option<String>,
}

/// A titled row of videos, and the grid "See all" opens.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExploreShelf {
    pub title: String,
    pub videos: Vec<VideoSummary>,
    pub more: Option<ExploreTarget>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExploreTab {
    pub title: String,
    pub target: ExploreTarget,
    pub selected: bool,
}

/// A destination's landing page: its shelves, and the category tabs it offers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorePage {
    pub title: Option<String>,
    pub tabs: Vec<ExploreTab>,
    pub shelves: Vec<ExploreShelf>,
}

/// One page of a shelf's full grid, and the token for the next.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExploreGrid {
    pub videos: Vec<VideoSummary>,
    pub continuation: Option<String>,
}
