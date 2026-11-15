/** A Mix is built around a video; `RDCLAK` ids are album playlists that only share the prefix. */
export function isMix(playlistId: string): boolean {
  return playlistId.startsWith("RD") && !playlistId.startsWith("RDCLAK");
}

/** The video a plain `RD<videoId>` Mix grew from, or null when its id names none. */
export function mixSeedVideoId(playlistId: string): string | null {
  const seed = playlistId.slice(2);
  return playlistId.startsWith("RD") && /^[A-Za-z0-9_-]{11}$/.test(seed) ? seed : null;
}
