import type { SongItem } from "../types/music";
import { getMusicQueueContinuation, getMusicWatchQueue, rankMusicCandidates } from "./api/music";
import { growPool, nextAnchor, nextBatch, radioAnchors } from "./musicRadioPlanner";

type QueuePage = Awaited<ReturnType<typeof getMusicWatchQueue>>;

const videoIdOf = (track: SongItem): string => track.videoId ?? track.id;

const stationIdFor = (videoId: string): string => `RDAMVM${videoId}`;

const isPlayableAudio = (s: SongItem): boolean => {
  const vt = s.musicVideoType;
  const isVideoSong = !!vt && vt !== "MUSIC_VIDEO_TYPE_ATV";
  const dur = s.duration ?? 0;
  const okDuration = dur === 0 || (dur >= 30 && dur <= 1200);
  return !isVideoSong && okDuration && !!(s.videoId ?? s.id);
};

export interface RadioRefillContext {
  /** Where a station that has not fetched anything yet starts from. */
  seed: SongItem;
  /** Everything in the queue, played or not: never suggested again. */
  queueIds: Set<string>;
  /** The station's own tracks still waiting in the queue, for the per-artist cap. */
  stationTracks: SongItem[];
  isHidden: (track: SongItem) => boolean;
}

/** Where the next page of a station comes from. */
type PageSource =
  | { kind: "continuation"; token: string }
  | { kind: "seed"; seedId: string }
  | { kind: "anchor"; anchorId: string };

/**
 * One radio station's state between queue top-ups: where YouTube's mix
 * continues, the ranked pool the queue takes from, and the anchor songs it
 * reseeds from once the mix runs out. `generation` changes on every reset, so
 * a fetch that outlives its station drops its answer.
 */
class RadioSession {
  generation = 0;
  private started = false;
  private continuation: string | null = null;
  private anchors: string[] = [];
  private usedAnchors = new Set<string>();
  private pool: SongItem[] = [];
  private dry = false;
  /** Every id the station has queued or been seeded with, so none comes back. */
  private readonly seen = new Set<string>();

  reset(seedIds: string[] = []): void {
    this.generation += 1;
    this.started = false;
    this.continuation = null;
    this.anchors = [];
    this.usedAnchors = new Set();
    this.pool = [];
    this.dry = false;
    this.seen.clear();
    for (const id of seedIds) this.seen.add(id);
  }

  poolSize(): number {
    return this.pool.length;
  }

  /** Nothing left to fetch and nothing left in the pool. */
  isExhausted(): boolean {
    return this.dry && this.pool.length === 0;
  }

  canRefill(): boolean {
    return !this.dry;
  }

  /** Takes the head of the pool for the queue, in the order it was ranked. */
  take(queueIds: Set<string>, limit: number): SongItem[] {
    const batch = nextBatch(this.pool, queueIds, limit);
    if (batch.length === 0) return batch;
    const taken = new Set(batch);
    this.pool = this.pool.filter((track) => !taken.has(track));
    for (const track of batch) this.seen.add(videoIdOf(track));
    return batch;
  }

  /** Fetches one more page of the station into the pool. False when nothing new arrived. */
  async refill(ctx: RadioRefillContext): Promise<boolean> {
    const generation = this.generation;
    const source = this.nextSource(ctx);
    if (!source) {
      this.dry = true;
      return false;
    }
    const page = await this.fetch(source);
    if (generation !== this.generation) return false;
    this.continuation = page.continuation;
    if (source.kind === "seed") {
      this.started = true;
      this.anchors = radioAnchors(source.seedId, page.items);
      this.usedAnchors = new Set([source.seedId]);
    }

    const candidates = page.items.filter((track) => {
      const id = videoIdOf(track);
      return isPlayableAudio(track) && !ctx.queueIds.has(id) && !this.seen.has(id) && !ctx.isHidden(track);
    });
    if (candidates.length === 0) return false;
    // Ranked once, here: the pool is consumed from its head, so a later top-up
    // never reorders songs already chosen.
    const ranked = await rankMusicCandidates(candidates, "radio").catch(() => candidates);
    if (generation !== this.generation) return false;
    const before = this.pool;
    this.pool = growPool(before, ranked, new Set([...ctx.queueIds, ...this.seen]), ctx.stationTracks);
    return this.pool !== before;
  }

  private nextSource(ctx: RadioRefillContext): PageSource | null {
    if (this.continuation) return { kind: "continuation", token: this.continuation };
    if (!this.started) return { kind: "seed", seedId: videoIdOf(ctx.seed) };
    const anchorId = nextAnchor(this.anchors, this.usedAnchors) ?? this.tailAnchor(ctx);
    if (!anchorId) return null;
    this.usedAnchors.add(anchorId);
    return { kind: "anchor", anchorId };
  }

  private async fetch(source: PageSource): Promise<QueuePage> {
    switch (source.kind) {
      case "continuation":
        return getMusicQueueContinuation(source.token);
      case "anchor":
        return getMusicWatchQueue(source.anchorId, stationIdFor(source.anchorId));
      case "seed": {
        // The seed's own queue names the site's automix for it: the same
        // station, with the params it continues with.
        const seedQueue = await getMusicWatchQueue(source.seedId).catch(() => null);
        const automix = seedQueue?.radioPlaylistId;
        return getMusicWatchQueue(
          source.seedId,
          automix ?? stationIdFor(source.seedId),
          automix ? (seedQueue?.radioParams ?? undefined) : undefined,
        );
      }
    }
  }

  // Past the anchors, Android carries on from the newest station track, once each.
  private tailAnchor(ctx: RadioRefillContext): string | null {
    const tail = this.pool[this.pool.length - 1] ?? ctx.stationTracks[ctx.stationTracks.length - 1];
    const id = tail ? videoIdOf(tail) : null;
    return id && !this.usedAnchors.has(id) ? id : null;
  }
}

export const radioSession = new RadioSession();
