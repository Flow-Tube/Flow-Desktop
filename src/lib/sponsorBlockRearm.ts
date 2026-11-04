/**
 * How far before a segment playback must land for it to act again, the same as
 * Android. A seek that lands slightly short of the requested end can't then loop
 * a skip.
 */
export const REARM_MARGIN_SECONDS = 1;

/** The segments a rewind to `position` puts back in play. */
export function segmentsToRearm<T extends { segment: [number, number] }>(segments: T[], position: number): T[] {
  return segments.filter(({ segment: [start] }) => position < start - REARM_MARGIN_SECONDS);
}
