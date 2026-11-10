import type { SongItem } from "../../types/music";
import { recapListen } from "./recapQueue";

/** A play counts past this share of the song, as MusicBrain's count milestone does. */
export const MUSIC_COUNT_FRACTION = 0.5;
/** Ended before this share, after a deliberate listen, a song was passed over. */
const FIRST_MILESTONE = 0.15;
/** A session shorter than this is a mis-tap, not a skip. */
const MIN_SKIP_LISTEN_SECONDS = 5;

const idOf = (track: SongItem): string => track.videoId ?? track.id;

interface OpenListen {
  track: SongItem;
  sentSeconds: number;
  fraction: number;
  counted: boolean;
  anythingSent: boolean;
}

function eventFor(listen: OpenListen) {
  const artist = listen.track.artists[0];
  return {
    trackId: idOf(listen.track),
    title: listen.track.title,
    artistId: artist?.id ?? null,
    artistName: artist?.name ?? "",
    artworkUrl: listen.track.thumbnail ?? "",
  };
}

/**
 * Turns the listen tracker's running totals into stretches for the ledger. The tracker reports the
 * total so far every few seconds; a total that falls, or another song, means a new listen began.
 */
export class RecapMusicSession {
  private open: OpenListen | null = null;

  note(track: SongItem, listenedSeconds: number, durationSeconds: number) {
    const current = this.open;
    if (current && (idOf(current.track) !== idOf(track) || listenedSeconds < current.sentSeconds)) this.close();
    const listen = this.open ?? { track, sentSeconds: 0, fraction: 0, counted: false, anythingSent: false };
    this.open = listen;
    const fraction = durationSeconds > 0 ? listenedSeconds / durationSeconds : 0;
    listen.fraction = Math.max(listen.fraction, fraction);
    const counted = !listen.counted && fraction >= MUSIC_COUNT_FRACTION;
    const newSeconds = listenedSeconds - listen.sentSeconds;
    if (!counted && newSeconds <= 0) return;
    recapListen({
      ...eventFor(listen),
      listenedMs: Math.round(newSeconds * 1000),
      counted,
      skipped: false,
      continued: listen.anythingSent,
    });
    listen.anythingSent = true;
    listen.sentSeconds = listenedSeconds;
    if (counted) listen.counted = true;
  }

  /** The listen is over: name it as skipped if it stopped early after more than a mis-tap. */
  private close() {
    const listen = this.open;
    this.open = null;
    if (!listen || listen.counted || listen.fraction >= FIRST_MILESTONE) return;
    if (listen.sentSeconds < MIN_SKIP_LISTEN_SECONDS) return;
    recapListen({ ...eventFor(listen), listenedMs: 0, counted: false, skipped: true, continued: true });
  }
}

/** A liked song counts as a play whatever its progress, as MusicBrain treats it. */
export function recapLikedSong(track: SongItem) {
  const artist = track.artists[0];
  recapListen({
    trackId: idOf(track),
    title: track.title,
    artistId: artist?.id ?? null,
    artistName: artist?.name ?? "",
    artworkUrl: track.thumbnail ?? "",
    listenedMs: 0,
    counted: true,
    skipped: false,
    continued: false,
  });
}
