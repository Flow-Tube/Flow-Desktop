export const STORY_PAGE_MS = 6_500;
/** Longer gaps between frames are time the story wasn't on screen. */
const MAX_FRAME_MS = 100;

export interface StoryPosition {
  page: number;
  elapsedMs: number;
}

/** Moves the story on by one frame. The last page waits instead of advancing. */
export function advanceStory(position: StoryPosition, frameMs: number, pageCount: number): StoryPosition {
  const elapsedMs = position.elapsedMs + Math.min(Math.max(frameMs, 0), MAX_FRAME_MS);
  if (elapsedMs < STORY_PAGE_MS) return { page: position.page, elapsedMs };
  if (position.page >= pageCount - 1) return { page: position.page, elapsedMs: STORY_PAGE_MS };
  return { page: position.page + 1, elapsedMs: 0 };
}

export function storyPageAt(page: number, pageCount: number): StoryPosition {
  return { page: Math.min(Math.max(page, 0), pageCount - 1), elapsedMs: 0 };
}
