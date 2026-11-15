//! Channel id to normalized handle, learned from everything that carries both. The list holds
//! handles while most feed cards carry only a channel id, so this is how a Home card still matches
//! a listed handle. The least recently used pairs go first past the capacity.

use std::collections::HashMap;

pub const DEFAULT_CAPACITY: usize = 50_000;

#[derive(Debug)]
pub struct HandleIndex {
    capacity: usize,
    tick: u64,
    entries: HashMap<String, (String, u64)>,
}

impl Default for HandleIndex {
    fn default() -> Self {
        Self::with_capacity(DEFAULT_CAPACITY)
    }
}

impl HandleIndex {
    #[must_use]
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            capacity: capacity.max(1),
            tick: 0,
            entries: HashMap::new(),
        }
    }

    /// Reads `pairs` oldest first; pairs learned before keep winning over them.
    #[must_use]
    pub fn from_pairs(pairs: Vec<(String, String)>, capacity: usize) -> Self {
        let mut index = Self::with_capacity(capacity);
        for (channel_id, handle) in pairs {
            index.learn(&channel_id, &handle);
        }
        index
    }

    pub fn handle_for(&mut self, channel_id: &str) -> Option<String> {
        self.tick += 1;
        let tick = self.tick;
        self.entries.get_mut(channel_id).map(|(handle, used)| {
            *used = tick;
            handle.clone()
        })
    }

    /// Records a pair; true when it was new or changed, so it is worth saving.
    pub fn learn(&mut self, channel_id: &str, normalized_handle: &str) -> bool {
        self.tick += 1;
        let previous = self.entries.insert(
            channel_id.to_string(),
            (normalized_handle.to_string(), self.tick),
        );
        // Trims in batches so a full index does not sort itself on every new pair.
        if self.entries.len() > self.capacity + self.capacity / 10 {
            self.trim();
        }
        previous.is_none_or(|(handle, _)| handle != normalized_handle)
    }

    /// Every pair, least recently used first, as it is saved.
    #[must_use]
    pub fn pairs(&self) -> Vec<(String, String)> {
        let mut entries: Vec<_> = self.entries.iter().collect();
        entries.sort_by_key(|(_, (_, used))| *used);
        entries
            .into_iter()
            .map(|(id, (handle, _))| (id.clone(), handle.clone()))
            .collect()
    }

    fn trim(&mut self) {
        let excess = self.entries.len().saturating_sub(self.capacity);
        let mut by_use: Vec<(u64, String)> = self
            .entries
            .iter()
            .map(|(id, (_, used))| (*used, id.clone()))
            .collect();
        by_use.sort_unstable();
        for (_, id) in by_use.into_iter().take(excess) {
            self.entries.remove(&id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_index_forgets_the_least_recently_used_channel_first() {
        let mut index = HandleIndex::with_capacity(2);
        index.learn("a", "one");
        index.learn("b", "two");
        index.handle_for("a");
        index.learn("c", "three");

        assert_eq!(index.handle_for("a").as_deref(), Some("one"));
        assert_eq!(index.handle_for("b"), None);
        assert_eq!(index.handle_for("c").as_deref(), Some("three"));
    }

    #[test]
    fn learning_says_whether_anything_changed() {
        let mut index = HandleIndex::default();
        assert!(index.learn("UCa", "one"));
        assert!(!index.learn("UCa", "one"));
        assert!(index.learn("UCa", "two"));
    }

    #[test]
    fn saved_pairs_come_back_in_the_same_order() {
        let mut index = HandleIndex::default();
        index.learn("a", "one");
        index.learn("b", "two");
        index.handle_for("a");
        let pairs = index.pairs();
        assert_eq!(pairs[0].0, "b");
        assert_eq!(HandleIndex::from_pairs(pairs.clone(), 10).pairs(), pairs);
    }
}
