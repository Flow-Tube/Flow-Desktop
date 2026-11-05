//! Settling the roster from every entry held (spec/protocol.md, Forks). The result depends only on
//! which entries are held, never on the order they were read.

use std::collections::{BTreeMap, BTreeSet};

use super::roster::{Entry, Op, RosterState, apply_entry, entry_hash, fork_winner};
use super::{Error, Result};

pub const MAX_ROSTER_ENTRIES: usize = 4096;

/// The chain the rule picks, or the entries it can't decide between.
#[derive(Debug, Default)]
pub struct ForkResolution {
    pub chain: Vec<Entry>,
    pub contested: Vec<Entry>,
    /// The contested entries that revoke another contested entry: what the user chooses between.
    pub sides: Vec<Entry>,
    /// The entries off the chain that stand and start an epoch: their keys still open objects.
    pub standing: Vec<Entry>,
}

/// What a device does with a store's view of the roster.
#[derive(Debug)]
pub enum Settlement {
    Apply {
        chain: Vec<Entry>,
        standing: Vec<Entry>,
        extends_applied: bool,
    },
    Contested {
        contested: Vec<Entry>,
        sides: Vec<Entry>,
    },
    Rollback,
    Rewritten,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Status {
    Stands,
    Falls,
}

struct Node {
    entry: Entry,
    state: RosterState,
    hash: String,
    parent: Option<usize>,
    children: Vec<usize>,
    revokes: Vec<usize>,
    waiting: usize,
    enter: usize,
    exit: usize,
    status: Option<Status>,
}

/// Every held entry that is valid against its parent, as a tree.
fn valid_tree(group: &str, held: &[Entry], genesis: Option<&str>) -> Result<Vec<Node>> {
    let mut sorted: Vec<&Entry> = held.iter().collect();
    sorted.sort_by_key(|entry| entry.seq);
    let mut nodes: Vec<Node> = Vec::new();
    let mut by_hash: BTreeMap<String, usize> = BTreeMap::new();
    for entry in sorted {
        let hash = entry_hash(entry);
        if by_hash.contains_key(&hash) || entry.group != group {
            continue;
        }
        let parent = if entry.op == Op::Genesis {
            if genesis.is_some_and(|genesis| genesis != hash) {
                continue;
            }
            None
        } else {
            let Some(parent) = by_hash.get(&entry.prev) else {
                continue;
            };
            Some(*parent)
        };
        let before = parent.map(|parent| &nodes[parent].state);
        let Ok(state) = apply_entry(before, entry) else {
            continue;
        };
        let index = nodes.len();
        if let Some(parent) = parent {
            nodes[parent].children.push(index);
        }
        by_hash.insert(hash.clone(), index);
        nodes.push(Node {
            entry: entry.clone(),
            state,
            hash,
            parent,
            children: Vec::new(),
            revokes: Vec::new(),
            waiting: 0,
            enter: 0,
            exit: 0,
            status: None,
        });
        if nodes.len() > MAX_ROSTER_ENTRIES {
            return Err(Error::RosterChain);
        }
    }
    Ok(nodes)
}

/// Numbers the tree so that an ancestor check takes constant time.
fn number_tree(nodes: &mut [Node]) {
    let mut clock = 0;
    for root in 0..nodes.len() {
        if nodes[root].parent.is_some() {
            continue;
        }
        nodes[root].enter = clock;
        clock += 1;
        let mut stack = vec![(root, 0)];
        while let Some(&(node, next)) = stack.last() {
            if let Some(&child) = nodes[node].children.get(next) {
                if let Some(top) = stack.last_mut() {
                    top.1 += 1;
                }
                nodes[child].enter = clock;
                clock += 1;
                stack.push((child, 0));
            } else {
                nodes[node].exit = clock;
                clock += 1;
                stack.pop();
            }
        }
    }
}

fn link_revocations(nodes: &mut [Node], pins: &BTreeSet<String>) {
    let mut by_signer: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (index, node) in nodes.iter().enumerate() {
        by_signer
            .entry(node.entry.signer.clone())
            .or_default()
            .push(index);
    }
    for y in 0..nodes.len() {
        let removed = nodes[y].entry.remove.clone().unwrap_or_default();
        for did in &removed {
            for &x in by_signer.get(did).into_iter().flatten() {
                let is_ancestor =
                    nodes[x].enter <= nodes[y].enter && nodes[y].exit <= nodes[x].exit;
                if !is_ancestor && !pins.contains(&nodes[x].hash) {
                    nodes[y].revokes.push(x);
                    nodes[x].waiting += 1;
                }
            }
        }
    }
}

fn may_stand(nodes: &[Node], index: usize) -> bool {
    nodes[index].waiting == 0
        && nodes[index]
            .parent
            .is_none_or(|parent| nodes[parent].status == Some(Status::Stands))
}

/// Decides what it can: whatever is left has no status, and is contested.
fn decide(nodes: &mut [Node]) {
    let mut next = Vec::new();
    for index in 0..nodes.len() {
        if may_stand(nodes, index) {
            nodes[index].status = Some(Status::Stands);
            next.push(index);
        }
    }
    while let Some(index) = next.pop() {
        let status = nodes[index].status;
        let mut decided = Vec::new();
        for &child in &nodes[index].children {
            if status == Some(Status::Falls) {
                decided.push((child, Status::Falls));
            } else if may_stand(nodes, child) {
                decided.push((child, Status::Stands));
            }
        }
        let revokes = nodes[index].revokes.clone();
        for revoked in revokes {
            if status == Some(Status::Stands) {
                decided.push((revoked, Status::Falls));
            } else {
                nodes[revoked].waiting -= 1;
                if may_stand(nodes, revoked) {
                    decided.push((revoked, Status::Stands));
                }
            }
        }
        for (node, status) in decided {
            if nodes[node].status.is_none() {
                nodes[node].status = Some(status);
                next.push(node);
            }
        }
    }
}

fn lowest_genesis_group(held: &[Entry]) -> Option<&str> {
    held.iter()
        .filter(|entry| apply_entry(None, entry).is_ok())
        .min_by_key(|entry| entry_hash(entry))
        .map(|entry| entry.group.as_str())
}

/// The fork rule. Without a known `group`, the group of the lowest valid genesis held is taken: a
/// device that just needs to read a store it isn't yet in checks what it finds afterwards.
pub fn resolve_forks(
    group: Option<&str>,
    held: &[Entry],
    pins: &BTreeSet<String>,
    genesis: Option<&str>,
) -> Result<ForkResolution> {
    let Some(group) = group.or_else(|| lowest_genesis_group(held)) else {
        return Ok(ForkResolution::default());
    };
    let mut nodes = valid_tree(group, held, genesis)?;
    number_tree(&mut nodes);
    link_revocations(&mut nodes, pins);
    decide(&mut nodes);

    let open: Vec<usize> = (0..nodes.len())
        .filter(|&index| nodes[index].status.is_none())
        .collect();
    if !open.is_empty() {
        let sides = open
            .iter()
            .filter(|&&index| {
                nodes[index]
                    .revokes
                    .iter()
                    .any(|&x| nodes[x].status.is_none())
            })
            .map(|&index| nodes[index].entry.clone())
            .collect();
        return Ok(ForkResolution {
            chain: Vec::new(),
            contested: open
                .iter()
                .map(|&index| nodes[index].entry.clone())
                .collect(),
            sides,
            standing: Vec::new(),
        });
    }

    let mut chain = Vec::new();
    let mut candidates: Vec<usize> = (0..nodes.len())
        .filter(|&index| {
            nodes[index].parent.is_none() && nodes[index].status == Some(Status::Stands)
        })
        .collect();
    while !candidates.is_empty() {
        let entries: Vec<Entry> = candidates.iter().map(|&i| nodes[i].entry.clone()).collect();
        let Some(winner) = fork_winner(&entries) else {
            break;
        };
        let hash = entry_hash(winner);
        let Some(&node) = candidates.iter().find(|&&i| nodes[i].hash == hash) else {
            break;
        };
        chain.push(nodes[node].entry.clone());
        candidates = nodes[node]
            .children
            .iter()
            .copied()
            .filter(|&child| nodes[child].status == Some(Status::Stands))
            .collect();
    }
    let on_chain: BTreeSet<String> = chain.iter().map(entry_hash).collect();
    let standing = nodes
        .iter()
        .filter(|node| {
            node.status == Some(Status::Stands)
                && node.entry.epoch.is_some()
                && !on_chain.contains(&node.hash)
        })
        .map(|node| node.entry.clone())
        .collect();
    Ok(ForkResolution {
        chain,
        standing,
        ..ForkResolution::default()
    })
}

/// What to do with a store's `view`, given the chain this device has `applied`. `linear` is a
/// Flow server, which has no honest way to change an entry it already answered with.
pub fn settle_roster(
    group: &str,
    applied: &[Entry],
    view: &[Entry],
    pins: &BTreeSet<String>,
    linear: bool,
) -> Result<Settlement> {
    let shown: BTreeSet<String> = view.iter().map(entry_hash).collect();
    if applied
        .iter()
        .any(|entry| !shown.contains(&entry_hash(entry)))
    {
        return Ok(Settlement::Rollback);
    }
    let genesis = applied.first().map(entry_hash);
    let resolved = resolve_forks(Some(group), view, pins, genesis.as_deref())?;
    if !resolved.contested.is_empty() {
        return Ok(Settlement::Contested {
            contested: resolved.contested,
            sides: resolved.sides,
        });
    }
    if resolved.chain.is_empty() {
        return Err(Error::RosterChain);
    }
    let extends_applied = applied.len() <= resolved.chain.len()
        && applied
            .iter()
            .zip(&resolved.chain)
            .all(|(a, b)| entry_hash(a) == entry_hash(b));
    if !extends_applied && linear {
        return Ok(Settlement::Rewritten);
    }
    Ok(Settlement::Apply {
        chain: resolved.chain,
        standing: resolved.standing,
        extends_applied,
    })
}

/// The chain the rule picks from what a store shows, or nothing while the roster is contested.
pub fn winning_chain(held: &[Entry], pins: &BTreeSet<String>) -> Vec<Entry> {
    resolve_forks(None, held, pins, None)
        .map(|resolved| resolved.chain)
        .unwrap_or_default()
}
