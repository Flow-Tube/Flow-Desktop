import type { LikedItem } from "../../store/useLikesStore";
import type { SongItem } from "../../types/music";

export interface LikeChange {
  song: SongItem;
  liked: boolean;
}

interface LikesSnapshot {
  items: readonly LikedItem[];
  loaded: boolean;
}

const songsById = (items: readonly LikedItem[]) =>
  new Map(items.flatMap((item) => (item.kind === "music" ? [[item.id, item.song] as const] : [])));

/**
 * The song a single like or unlike changed. Loading the library, a sync or a restore changes
 * many songs at once, and those are not the listener's likes, so they give nothing.
 */
export function likeChange(previous: LikesSnapshot, next: LikesSnapshot): LikeChange | null {
  if (!previous.loaded || !next.loaded || previous.items === next.items) return null;
  const before = songsById(previous.items);
  const after = songsById(next.items);
  const added = [...after].filter(([id]) => !before.has(id));
  const removed = [...before].filter(([id]) => !after.has(id));
  if (added.length + removed.length !== 1) return null;
  const [entry, liked] = added.length === 1 ? [added[0]!, true] : [removed[0]!, false];
  return { song: entry[1], liked };
}
