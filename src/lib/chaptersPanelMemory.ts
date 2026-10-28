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
