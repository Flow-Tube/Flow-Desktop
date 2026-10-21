//! What the Home service asks of the recommendation engine beyond ranking: interest share, related
//! seeds with their cooldown, co-watch learning from related lists, and neighbour channels.

use std::collections::{HashMap, HashSet};

use crate::flow_neuro::categories::cluster_category;
use crate::flow_neuro::clusters::TopicCluster;
use crate::flow_neuro::clusters::{ClusterInputs, build_clusters};
use crate::flow_neuro::co_watch::RelatedChannel;
use crate::flow_neuro::discovery::exploration_queries;
use crate::flow_neuro::features::pick_keys;
use crate::flow_neuro::interest_chips::{InterestChip, chips, groups, stable};
use crate::flow_neuro::rank::{about, clusters_of, share_by_interest};
use crate::flow_neuro::scoring::CHANNEL_SUPPRESSION_DAYS;
use crate::flow_neuro::scoring::classify_persona;
use crate::flow_neuro::specificity::specificity;
use crate::models::video::VideoSummary;
use crate::services::home_feed::card::Card;
use crate::services::home_feed::neighbours::{Neighbour, neighbours};
use crate::services::home_feed::seeds::{SeedClusters, SeedInput, select_with_long_term};
use crate::services::recommendation_service::{RecommendationService, is_watched_channel};

const RELATED_SEED_COOLDOWN_MS: u64 = 6 * 3_600_000;
const RECENT_RELATED_SEEDS_MAX: usize = 60;
const DAY_MS: u64 = 86_400_000;

fn related_channels(cards: &[Card]) -> Vec<RelatedChannel> {
    cards
        .iter()
        .filter(|card| !card.channel_id().is_empty())
        .map(|card| RelatedChannel {
            channel_id: card.channel_id().to_string(),
            channel_name: card.video.channel_name.clone(),
        })
        .collect()
}

impl RecommendationService {
    /// `ranked` with its places shared between the viewer's lasting interests.
    pub async fn share_by_interest(
        &self,
        ranked: Vec<VideoSummary>,
        user_subs: &HashSet<String>,
    ) -> Vec<VideoSummary> {
        if ranked.len() < 2 {
            return ranked;
        }
        self.with_rank_context(user_subs, 0.0, false, |ctx| share_by_interest(ctx, ranked))
            .await
    }

    /// The related seeds for one pass: hidden videos and channels left out, interests spread, seeds
    /// used in the last six hours resting unless nothing else qualifies. The picks start resting.
    pub async fn select_related_seeds(
        &self,
        candidates: &[SeedInput],
        max_seeds: usize,
        long_term: &[SeedInput],
    ) -> Vec<String> {
        if candidates.is_empty() {
            return Vec::new();
        }
        let now_ms = self.get_current_time_ms();
        let selected = {
            let brain = self.brain_store.read().await;
            let channel_cutoff = now_ms.saturating_sub(CHANNEL_SUPPRESSION_DAYS * DAY_MS);
            let excluded: HashSet<String> = brain
                .blocked_channels
                .iter()
                .cloned()
                .chain(
                    brain
                        .suppressed_channels
                        .iter()
                        .filter(|(_, at)| **at > channel_cutoff)
                        .map(|(id, _)| id.clone()),
                )
                .collect();
            let cooldown_cutoff = now_ms.saturating_sub(RELATED_SEED_COOLDOWN_MS);
            let cooled: HashSet<String> = brain
                .recent_related_seeds
                .iter()
                .filter(|(_, at)| **at > cooldown_cutoff)
                .map(|(id, _)| id.clone())
                .collect();
            let interests: HashMap<String, f64> =
                brain.interests().map(|(k, v)| (k.clone(), v)).collect();
            let spec = brain.key_spec();
            let is_watched = |channel: &str| is_watched_channel(&brain, channel);
            let channel_edges = self.stores.co_watch.edges(&is_watched, now_ms);
            let clusters = build_clusters(&ClusterInputs {
                topic_scores: &interests,
                affinities: &brain.topic_affinities,
                channel_topic_profiles: &brain.channel_topic_profiles,
                channel_edges: &channel_edges,
                spec: &spec,
            });
            let seed_clusters = SeedClusters::new(&spec, &interests, &clusters);
            let hidden = &brain.suppressed_video_ids;
            let visible = |seeds: &[SeedInput]| -> Vec<SeedInput> {
                seeds
                    .iter()
                    .filter(|s| !hidden.contains_key(&s.id))
                    .cloned()
                    .collect()
            };
            select_with_long_term(
                &visible(candidates),
                max_seeds,
                &visible(long_term),
                &seed_clusters,
                now_ms,
                &cooled,
                &excluded,
            )
        };
        if !selected.is_empty() {
            let mut brain = self.brain_store.write().await;
            let cutoff = now_ms.saturating_sub(RELATED_SEED_COOLDOWN_MS);
            brain.recent_related_seeds.retain(|_, at| *at >= cutoff);
            for id in &selected {
                brain.recent_related_seeds.insert(id.clone(), now_ms);
            }
            if brain.recent_related_seeds.len() > RECENT_RELATED_SEEDS_MAX {
                let mut by_age: Vec<(String, u64)> = brain.recent_related_seeds.drain().collect();
                by_age.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
                brain.recent_related_seeds =
                    by_age.into_iter().take(RECENT_RELATED_SEEDS_MAX).collect();
            }
        }
        selected
    }

    /// Records `related`, the list beside a video of `channel_id` the viewer watched, liked or
    /// follows, as a co-watch source. Feed seeds teach nothing; Deep Flow learns nothing.
    pub async fn note_related_of(&self, video_id: &str, channel_id: &str, related: &[Card]) {
        if channel_id.is_empty() || self.learning_paused().await {
            return;
        }
        let now_ms = self.get_current_time_ms();
        let _ = self
            .stores
            .co_watch
            .record(video_id, channel_id, &related_channels(related), now_ms)
            .await;
    }

    /// Videos whose related list co-watch already holds.
    pub fn co_watch_source_ids(&self) -> HashSet<String> {
        self.stores.co_watch.source_ids()
    }

    /// Channels at least two of the viewer's own sit next to: those followed and those a watch
    /// raised, never a blocked, suppressed or poorly received one.
    pub async fn neighbour_channels(&self, followed: &HashMap<String, String>) -> Vec<Neighbour> {
        let now_ms = self.get_current_time_ms();
        let brain = self.brain_store.read().await;
        let suppression_cutoff = now_ms.saturating_sub(CHANNEL_SUPPRESSION_DAYS * DAY_MS);
        let anchors: HashSet<String> = followed
            .keys()
            .cloned()
            .chain(
                brain
                    .channel_scores
                    .keys()
                    .filter(|channel| is_watched_channel(&brain, channel))
                    .cloned(),
            )
            .collect();
        let excluded = |channel: &str| {
            brain.blocked_channels.contains(channel)
                || brain
                    .suppressed_channels
                    .get(channel)
                    .is_some_and(|at| *at > suppression_cutoff)
                || brain.channel_scores.get(channel).copied().unwrap_or(0.5) < 0.5
        };
        let mut names = self.stores.co_watch.names();
        names.extend(followed.iter().map(|(id, name)| (id.clone(), name.clone())));
        neighbours(
            &self.stores.co_watch.sources(),
            &anchors,
            &excluded,
            &names,
            now_ms,
        )
    }

    /// Whether a card was shown recently enough that Home leaves it out (the seen gate's rule).
    pub async fn recently_shown(&self) -> HashSet<String> {
        let now_ms = self.get_current_time_ms();
        let brain = self.brain_store.read().await;
        brain
            .feed_history
            .iter()
            .filter(|(_, entry)| crate::flow_neuro::gates::is_recently_seen(Some(entry), now_ms))
            .map(|(id, _)| id.clone())
            .collect()
    }

    /// Home's interest chips, kept steady across loads; the chosen set is remembered in the brain.
    pub async fn interest_chips(&self) -> Vec<InterestChip> {
        let now_ms = self.get_current_time_ms();
        let (set, chips) = self
            .with_rank_context(&HashSet::new(), 0.0, false, |ctx| {
                let brain = ctx.brain;
                let clusters = clusters_of(ctx);
                let picks = pick_keys(brain);
                let has_evidence = |cluster: &TopicCluster| {
                    cluster.topics.len() >= 2
                        || cluster.topics.iter().any(|t| picks.contains(t))
                        || brain
                            .topic_evidence
                            .get(&cluster.representative)
                            .is_some_and(|e| {
                                e.watch_signals >= 2
                                    || e.explicit_signals > 0
                                    || e.positive_score >= 1.2
                            })
                };
                let category_of = |cluster: &TopicCluster| {
                    cluster_category(
                        &cluster.topics,
                        &brain.channel_topic_profiles,
                        ctx.category_of,
                    )
                };
                let groups = groups(&clusters, has_evidence, category_of);
                let set = stable(&brain.interest_chips, &groups, now_ms);
                let table = specificity(&brain.key_spec());
                let chips = chips(
                    &set,
                    &groups,
                    &brain.display_forms,
                    |topic| table.of(topic),
                    |topic| {
                        brain
                            .topic_evidence
                            .get(topic)
                            .map_or(0, |e| e.watch_signals + e.explicit_signals)
                    },
                );
                (set, chips)
            })
            .await;
        // Only a new choice writes, so an unchanged brain is not saved again.
        if self.brain_store.read().await.interest_chips != set {
            self.brain_store.write().await.interest_chips = set;
        }
        chips
    }

    /// The videos whose channel is known to post in another category than `category`.
    #[must_use]
    pub fn outside_category(&self, videos: &[VideoSummary], category: &str) -> HashSet<String> {
        videos
            .iter()
            .filter(|video| {
                video
                    .channel_id
                    .as_deref()
                    .and_then(|channel| self.stores.categories.category_of(channel))
                    .is_some_and(|known| known.id != category)
            })
            .map(|video| video.id.clone())
            .collect()
    }

    /// The videos about one of `topics`, as their titles and channels read.
    pub async fn about(
        &self,
        videos: Vec<VideoSummary>,
        topics: &HashSet<String>,
    ) -> Vec<VideoSummary> {
        if videos.is_empty() {
            return videos;
        }
        self.with_rank_context(&HashSet::new(), 0.0, false, |ctx| {
            about(ctx, videos, topics)
        })
        .await
    }

    /// Searches for the topics next to the viewer's interests, strongest first.
    pub async fn exploration_queries(&self, limit: usize) -> Vec<String> {
        let now_ms = self.get_current_time_ms();
        let brain = self.brain_store.read().await;
        let is_watched = |channel: &str| is_watched_channel(&brain, channel);
        let channel_edges = self.stores.co_watch.edges(&is_watched, now_ms);
        exploration_queries(
            &brain,
            classify_persona(&brain),
            now_ms,
            &channel_edges,
            limit,
        )
    }
}
