import type { ComponentProps } from "react";
import { usePlayerStore } from "../../store/usePlayerStore";
import { SubtitleOverlay } from "./SubtitleOverlay";

/**
 * The main player's captions. They follow the playback time here, in a leaf,
 * so the player around them does not re-render on every time tick.
 */
export function PlayerSubtitles(props: Omit<ComponentProps<typeof SubtitleOverlay>, "currentTime">) {
  const currentTime = usePlayerStore((state) => state.currentTime);
  return <SubtitleOverlay {...props} currentTime={currentTime} />;
}
