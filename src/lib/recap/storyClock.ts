import type { StoryPage } from "./storyPages";

export const STORY_PAGE_MS = 6_500;
/** Pages with a list to read stay up longer. */
const LIST_PAGE_MS = 8_500;
const LIST_PAGES: ReadonlySet<StoryPage["kind"]> = new Set(["topics", "songs", "newToYou", "passedOn"]);
/** Longer gaps between frames are time the story wasn't on screen. */
const MAX_FRAME_MS = 100;

export interface StoryPosition {
  page: number;
  elapsedMs: number;
}

export const storyPageMs = (kind: StoryPage["kind"]): number => (LIST_PAGES.has(kind) ? LIST_PAGE_MS : STORY_PAGE_MS);

/** Moves the story on by one frame. The last page waits, full, instead of advancing. */
export function advanceStory(position: StoryPosition, frameMs: number, durations: readonly number[]): StoryPosition {
  const elapsedMs = position.elapsedMs + Math.min(Math.max(frameMs, 0), MAX_FRAME_MS);
  const duration = durations[position.page] ?? STORY_PAGE_MS;
  if (elapsedMs < duration) return { page: position.page, elapsedMs };
  if (position.page >= durations.length - 1) return { page: position.page, elapsedMs: duration };
  return { page: position.page + 1, elapsedMs: 0 };
}

export function hasFinished(position: StoryPosition, durations: readonly number[]): boolean {
  return position.page === durations.length - 1 && position.elapsedMs >= (durations[position.page] ?? STORY_PAGE_MS);
}

export function storyPageAt(page: number, pageCount: number): StoryPosition {
  return { page: Math.min(Math.max(page, 0), pageCount - 1), elapsedMs: 0 };
}
