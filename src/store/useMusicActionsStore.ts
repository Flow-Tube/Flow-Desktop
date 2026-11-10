import { useCallback, useMemo } from "react";
import { create } from "zustand";
import { getSetting, setSetting } from "../lib/api/db";
import { blockMusicArtist, dislikeMusicArtist, unblockMusicArtist } from "../lib/api/music";
import { recapArtistSaidNo } from "../lib/recap/recapQueue";
import { useMusicPlayerStore } from "./useMusicPlayerStore";
import type { SongItem } from "../types/music";

// Global music feedback state, the music-section twin of `useFeedActionsStore`. Track-card
// menus call the actions here; every music surface (home shelves, radio, queue, collection
// and artist lists, search) filters against the sets — so a dismiss/block takes effect
// everywhere at once and persists across restarts. Mirrors the escalating semantics of the
// video side: a first "not interested" soft-suppresses the artist; a second (while still
// suppressed) promotes to a permanent "don't recommend" block, which is also enforced in the
// backend MusicBrain so blocked artists are never even ranked.
const STORE_KEY = "music_actions_state_v1";
const DISMISSED_CAP = 4000;
const BLOCKED_CAP = 1000;
const SUPPRESSED_CAP = 1000;
const ARTIST_SUPPRESSION_MS = 14 * 24 * 60 * 60 * 1000;

/** Resolves a stable artist key — id when present, else a normalized name. Mirrors the
 *  backend's `artist_key` so frontend filtering and backend blocking agree. */
export function musicArtistKey(artist?: { id?: string | null; name?: string | null } | null): string {
  if (!artist) return "";
  const id = (artist.id ?? "").trim();
  if (id) return id;
  return (artist.name ?? "").trim().toLowerCase();
}

/** The track identity used for per-track dismissals (prefers the playable videoId). */
export function trackKeyOf(song: SongItem): string {
  return song.videoId ?? song.id;
}

function addCapped(set: Set<string>, value: string, cap: number): Set<string> {
  if (!value || set.has(value)) return set;
  const next = new Set(set);
  next.add(value);
  return next.size > cap ? new Set([...next].slice(next.size - cap)) : next;
}

function addCappedMap<V>(map: Map<string, V>, key: string, value: V, cap: number): Map<string, V> {
  if (!key) return map;
  const next = new Map(map);
  next.set(key, value);
  return next.size > cap ? new Map([...next].slice(next.size - cap)) : next;
}

function activeSuppressed(entries: Map<string, number>): Map<string, number> {
  const cutoff = Date.now() - ARTIST_SUPPRESSION_MS;
  return new Map([...entries].filter(([, ts]) => ts >= cutoff));
}

interface MusicActionsState {
  dismissedTrackIds: Set<string>;
  /** key → display name, so the management UI can render and unblock. */
  blockedArtists: Map<string, string>;
  suppressedArtistKeys: Map<string, number>;
  loaded: boolean;
  load: () => Promise<void>;
  notInterested: (song: SongItem) => Promise<void>;
  blockArtist: (artist: { id?: string | null; name: string }) => Promise<void>;
  unblockArtist: (key: string) => Promise<void>;
}

/** Builds the hide predicate from a snapshot of the sets (shared by the hook and the
 *  player-store sync, which can't use React hooks). */
function buildHiddenPredicate(state: {
  dismissedTrackIds: Set<string>;
  blockedArtists: Map<string, string>;
  suppressedArtistKeys: Map<string, number>;
}): (song: SongItem) => boolean {
  const dismissed = state.dismissedTrackIds;
  const blocked = state.blockedArtists;
  const active = activeSuppressed(state.suppressedArtistKeys);
  return (song: SongItem) => {
    if (dismissed.has(trackKeyOf(song))) return true;
    for (const artist of song.artists ?? []) {
      const key = musicArtistKey(artist);
      if (key && (blocked.has(key) || active.has(key))) return true;
    }
    return false;
  };
}

export const useMusicActionsStore = create<MusicActionsState>((set, get) => {
  const persist = () => {
    const { dismissedTrackIds, blockedArtists, suppressedArtistKeys } = get();
    const activeS = activeSuppressed(suppressedArtistKeys);
    void setSetting(
      STORE_KEY,
      JSON.stringify({
        dismissed: [...dismissedTrackIds],
        blocked: [...blockedArtists.entries()],
        suppressed: [...activeS.entries()],
      }),
    ).catch((e) => console.warn("Failed to persist music actions", e));
  };

  // Push the current hide predicate into the player store so radio autoplay skips hidden
  // tracks, and prune any already-queued tracks that just became hidden.
  const syncPlayer = () => {
    const predicate = buildHiddenPredicate(get());
    const player = useMusicPlayerStore.getState();
    player.setHiddenPredicate?.(predicate);
    player.pruneQueue?.(predicate);
  };

  return {
    dismissedTrackIds: new Set(),
    blockedArtists: new Map(),
    suppressedArtistKeys: new Map(),
    loaded: false,

    load: async () => {
      if (get().loaded) return;
      try {
        const raw = await getSetting(STORE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as {
            dismissed?: string[];
            blocked?: [string, string][];
            suppressed?: [string, number][];
          };
          set({
            dismissedTrackIds: new Set(parsed.dismissed ?? []),
            blockedArtists: new Map(
              (parsed.blocked ?? []).filter(([key]) => typeof key === "string" && key.length > 0),
            ),
            suppressedArtistKeys: activeSuppressed(
              new Map(
                (parsed.suppressed ?? []).filter(
                  ([key, ts]) => typeof key === "string" && key.length > 0 && Number.isFinite(ts),
                ),
              ),
            ),
            loaded: true,
          });
        } else {
          set({ loaded: true });
        }
      } catch (e) {
        console.warn("Failed to load music actions", e);
        set({ loaded: true });
      }
      syncPlayer();
    },

    notInterested: async (song) => {
      const trackId = trackKeyOf(song);
      const primary = song.artists?.[0] ?? null;
      const key = musicArtistKey(primary);
      const escalate = key.length > 0 && activeSuppressed(get().suppressedArtistKeys).has(key);

      if (escalate && primary) {
        // Second "not interested" on a still-suppressed artist → permanent block.
        set((s) => ({ dismissedTrackIds: addCapped(s.dismissedTrackIds, trackId, DISMISSED_CAP) }));
        await get().blockArtist({ id: primary.id, name: primary.name });
        return;
      }

      set((s) => ({
        dismissedTrackIds: addCapped(s.dismissedTrackIds, trackId, DISMISSED_CAP),
        suppressedArtistKeys: key
          ? addCappedMap(s.suppressedArtistKeys, key, Date.now(), SUPPRESSED_CAP)
          : s.suppressedArtistKeys,
      }));
      persist();
      syncPlayer();
      if (primary && key) {
        try {
          await dislikeMusicArtist(primary.id ?? null, primary.name);
          recapArtistSaidNo(primary.id ?? null, primary.name, false);
        } catch (e) {
          console.warn("Failed to record music not-interested", e);
        }
      }
    },

    blockArtist: async ({ id, name }) => {
      const key = musicArtistKey({ id, name });
      if (!key) return;
      set((s) => {
        const blocked = addCappedMap(s.blockedArtists, key, name || key, BLOCKED_CAP);
        const suppressed = new Map(s.suppressedArtistKeys);
        suppressed.delete(key);
        return { blockedArtists: blocked, suppressedArtistKeys: suppressed };
      });
      persist();
      syncPlayer();
      try {
        await blockMusicArtist(id ?? null, name);
        recapArtistSaidNo(id ?? null, name, true);
      } catch (e) {
        console.warn("Failed to block music artist", e);
      }
    },

    unblockArtist: async (key) => {
      if (!key) return;
      set((s) => {
        const blocked = new Map(s.blockedArtists);
        blocked.delete(key);
        return { blockedArtists: blocked };
      });
      persist();
      syncPlayer();
      try {
        await unblockMusicArtist(key);
      } catch (e) {
        console.warn("Failed to unblock music artist", e);
      }
    },
  };
});

/** Reactive predicate for music feeds: true when a song should be hidden (its track was
 *  dismissed, or any of its artists is blocked or actively suppressed). */
export function useMusicHiddenFilter(): (song: SongItem) => boolean {
  const dismissed = useMusicActionsStore((s) => s.dismissedTrackIds);
  const blocked = useMusicActionsStore((s) => s.blockedArtists);
  const suppressed = useMusicActionsStore((s) => s.suppressedArtistKeys);
  const active = useMemo(() => activeSuppressed(suppressed), [suppressed]);
  return useCallback(
    (song: SongItem) => {
      if (dismissed.has(trackKeyOf(song))) return true;
      for (const artist of song.artists ?? []) {
        const key = musicArtistKey(artist);
        if (key && (blocked.has(key) || active.has(key))) return true;
      }
      return false;
    },
    [dismissed, blocked, active],
  );
}

/** Reactive predicate for artist entities (artist cards / shelves). */
export function useMusicArtistHidden(): (artist: { id?: string | null; name?: string | null }) => boolean {
  const blocked = useMusicActionsStore((s) => s.blockedArtists);
  const suppressed = useMusicActionsStore((s) => s.suppressedArtistKeys);
  const active = useMemo(() => activeSuppressed(suppressed), [suppressed]);
  return useCallback(
    (artist) => {
      const key = musicArtistKey(artist);
      return key.length > 0 && (blocked.has(key) || active.has(key));
    },
    [blocked, active],
  );
}
