import type { VideoFit } from "../store/usePlayerStore";

export const VIDEO_FITS: readonly VideoFit[] = ["fit", "fill", "zoom"];

export const VIDEO_FIT_LABELS = {
  fit: "player_resize_fit",
  fill: "player_resize_fill",
  zoom: "player_resize_zoom",
} as const satisfies Record<VideoFit, string>;

export const VIDEO_FIT_CLASS: Record<VideoFit, string> = {
  fit: "object-contain",
  fill: "object-fill",
  zoom: "object-cover",
};
