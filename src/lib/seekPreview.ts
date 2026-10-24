import type { HeatmapMarker, StoryboardLevel } from "../types/video";

/** The width a preview frame is drawn at; the level nearest it is used. */
export const PREVIEW_WIDTH = 160;

/** The level whose frames are nearest the drawn size: coarser is unreadable, finer crosses more sheets. */
export function pickStoryboardLevel(levels: StoryboardLevel[] | undefined, width = PREVIEW_WIDTH): StoryboardLevel | null {
  if (!levels?.length) return null;
  return levels.reduce((best, level) => (Math.abs(level.width - width) < Math.abs(best.width - width) ? level : best));
}

export interface StoryboardFrame {
  url: string;
  /** The frame's offset inside its sheet, in the level's own pixels. */
  x: number;
  y: number;
  sheetWidth: number;
  sheetHeight: number;
}

/** The sheet and tile that show `seconds` into the video. */
export function storyboardFrameAt(level: StoryboardLevel, seconds: number): StoryboardFrame {
  const index = Math.min(level.count - 1, Math.max(0, Math.floor((seconds * 1000) / level.intervalMs)));
  const perSheet = level.columns * level.rows;
  const sheet = Math.floor(index / perSheet);
  const within = index % perSheet;
  return {
    url: level.urlTemplate.replace("$M", String(sheet)),
    x: (within % level.columns) * level.width,
    y: Math.floor(within / level.columns) * level.height,
    sheetWidth: level.columns * level.width,
    sheetHeight: level.rows * level.height,
  };
}

/**
 * The most-replayed graph as an SVG path over a `width` × `height` box: a filled
 * area along the bottom, one point per marker at its middle.
 */
export function heatmapPath(markers: HeatmapMarker[] | undefined, durationSeconds: number, width = 1000, height = 100): string | null {
  if (!markers?.length || !(durationSeconds > 0)) return null;
  const durationMs = durationSeconds * 1000;
  const points = [...markers]
    .sort((a, b) => a.startMs - b.startMs)
    .map((marker) => {
      const x = Math.min(width, ((marker.startMs + marker.durationMs / 2) / durationMs) * width);
      const y = height - Math.max(0, Math.min(1, marker.intensity)) * height;
      return `L${x.toFixed(1)},${y.toFixed(1)}`;
    });
  return `M0,${height} ${points.join(" ")} L${width},${height} Z`;
}
