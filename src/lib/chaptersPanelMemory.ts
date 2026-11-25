import type { CaptionCue } from "../components/player/SubtitleOverlay";

/*
  The chapters panel remounts when it moves into the fullscreen side panel and back.
  These keep what it had: the tab and caption track picked for the video, and the
  transcripts already fetched, so the move shows the same view without a refetch.
*/

export type ChaptersTab = "chapters" | "transcript";

interface PanelView {
  tab: ChaptersTab;
  captionId: string;
}

const MAX_TRANSCRIPTS = 8;
const transcripts = new Map<string, CaptionCue[]>();
let view: { videoId: string; value: PanelView } | null = null;

export function rememberedView(videoId: string | undefined): PanelView | null {
  return videoId && view?.videoId === videoId ? view.value : null;
}

export function rememberView(videoId: string | undefined, value: PanelView) {
  if (videoId) view = { videoId, value };
}

export function cachedTranscript(url: string): CaptionCue[] | null {
  return transcripts.get(url) ?? null;
}

export function rememberTranscript(url: string, cues: CaptionCue[]) {
  transcripts.delete(url);
  transcripts.set(url, cues);
  while (transcripts.size > MAX_TRANSCRIPTS) {
    const oldest = transcripts.keys().next().value;
    if (oldest === undefined) break;
    transcripts.delete(oldest);
  }
}

/*
  A tab asked for from outside the panel, such as the description's Transcript row: taken by
  the panel when it mounts, or passed straight to it when it is already open.
*/
let requestedTab: { videoId: string; tab: ChaptersTab } | null = null;
const tabListeners = new Set<(videoId: string, tab: ChaptersTab) => boolean>();

export function requestTab(videoId: string, tab: ChaptersTab) {
  requestedTab = { videoId, tab };
  for (const listener of tabListeners) if (listener(videoId, tab)) requestedTab = null;
}

/** The tab asked for `videoId`, left in place: rendering may read it twice. */
export function requestedTabFor(videoId: string | undefined): ChaptersTab | null {
  return videoId && requestedTab?.videoId === videoId ? requestedTab.tab : null;
}

export function clearRequestedTab(videoId: string | undefined) {
  if (requestedTab?.videoId === videoId) requestedTab = null;
}

/** `listener` returns true when it took the tab. Returns the unsubscribe. */
export function onTabRequest(listener: (videoId: string, tab: ChaptersTab) => boolean): () => void {
  tabListeners.add(listener);
  return () => tabListeners.delete(listener);
}
