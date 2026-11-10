import type { CSSProperties } from "react";

import type { RecapSummary } from "../api/recap";
import { proxyImageUrl } from "../api/images";
import { getPlural, getString } from "../i18n/index";
import { proxiedImage } from "../imageProxy";
import { useImageProxyStore } from "../../store/useImageProxyStore";
import { INSIGHT_LABELS, spentTimeLabel } from "./recapFormat";

export const POSTER_WIDTH = 1080;
export const POSTER_HEIGHT = 1920;
const PADDING = 72;
const TILE_GAP = 24;
const TILE_HEIGHT = 168;
const MAX_PORTRAIT = 520;
/** How much of a portrait the second one covers. */
const PORTRAIT_OVERLAP = 0.24;
const HEADER_BOTTOM = PADDING + 136;
const LOAD_TIMEOUT_MS = 5_000;

export interface PosterData {
  periodLabel: string;
  totalTime: string;
  tiles: [value: string, label: string][];
  channelName: string | null;
  artistName: string | null;
  insight: string | null;
}

export function posterData(summary: RecapSummary, periodLabel: string): PosterData {
  const insight = summary.insights[0];
  return {
    periodLabel,
    totalTime: spentTimeLabel(summary.combined.totalMs),
    tiles: [
      [String(summary.video.views), getString("recap_views")],
      [String(summary.music.plays), getString("recap_plays")],
      [String(summary.combined.activeDays), getString("recap_active_days")],
      [getPlural("recap_days", summary.combined.longestStreak), getString("recap_streak")],
    ],
    channelName: summary.video.topChannels[0]?.name || null,
    artistName: summary.music.topArtists[0]?.name || null,
    insight: insight ? getString(INSIGHT_LABELS[insight][0]) : null,
  };
}

export interface PosterPalette {
  ground: string;
  ink: string;
  tile: string;
  tileInk: string;
  font: string;
}

/**
 * The last story page's colours turned around, accent ground and page-coloured ink, so the card reads
 * as an object on its page and as a poster alone. A canvas can't read CSS variables or `color-mix`,
 * so they are resolved through an element first.
 */
export function posterPalette(tint: CSSProperties): PosterPalette {
  const probe = document.createElement("div");
  for (const [name, value] of Object.entries(tint)) probe.style.setProperty(name, String(value));
  document.body.append(probe);
  const resolve = (color: string) => {
    probe.style.color = color;
    return getComputedStyle(probe).color;
  };
  const palette = {
    ground: resolve("var(--story-accent)"),
    ink: resolve("var(--story-ground)"),
    tile: resolve("var(--story-raised)"),
    tileInk: resolve("var(--color-on-surface)"),
    font: getComputedStyle(document.body).fontFamily,
  };
  probe.remove();
  return palette;
}

/** Shortens `text` with an ellipsis until it fits. */
export function fitText(ctx: Pick<CanvasRenderingContext2D, "measureText">, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 0 && ctx.measureText(`${text.slice(0, end)}…`).width > maxWidth) end--;
  return `${text.slice(0, end).trimEnd()}…`;
}

function drawPortrait(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  name: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  ink: string,
  font: string,
) {
  const radius = size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + radius, y + radius, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.clip();
  if (image) {
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    ctx.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      x,
      y,
      size,
      size,
    );
  } else {
    ctx.fillStyle = ink;
    ctx.font = `800 140px ${font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name.slice(0, 1).toUpperCase(), x + radius, y + radius);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();
}

/**
 * The card the story ends on and the image that gets saved: the period's two faces, its time in a
 * headline figure, four tiles, the trait that stood out and the Flow mark.
 */
export function drawPoster(
  ctx: CanvasRenderingContext2D,
  data: PosterData,
  images: { channel: HTMLImageElement | null; artist: HTMLImageElement | null },
  palette: PosterPalette,
) {
  const { font, ground, ink, tile, tileInk } = palette;
  const contentWidth = POSTER_WIDTH - PADDING * 2;
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);

  ctx.fillStyle = ink;
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 36px ${font}`;
  ctx.fillText(getString("recap_title"), PADDING, PADDING + 36);
  ctx.font = `800 84px ${font}`;
  ctx.fillText(fitText(ctx, data.periodLabel, contentWidth), PADDING, HEADER_BOTTOM);

  let y = POSTER_HEIGHT - PADDING;
  ctx.fillStyle = ink;
  ctx.font = `500 32px ${font}`;
  ctx.textAlign = "right";
  ctx.fillText(getString("recap_story_made_with"), POSTER_WIDTH - PADDING, y);
  ctx.textAlign = "left";
  if (data.insight) {
    ctx.font = `700 44px ${font}`;
    ctx.fillText(fitText(ctx, data.insight, contentWidth * 0.6), PADDING, y);
  }
  y -= 88;

  const named: [string, string | null][] = [
    [getString("recap_summary_top_artist"), data.artistName],
    [getString("recap_summary_top_channel"), data.channelName],
  ];
  for (const [label, value] of named) {
    if (!value) continue;
    ctx.font = `700 44px ${font}`;
    ctx.fillText(fitText(ctx, value, contentWidth), PADDING, y);
    ctx.font = `500 30px ${font}`;
    ctx.fillText(label, PADDING, y - 54);
    y -= 124;
  }

  const tileWidth = (contentWidth - TILE_GAP) / 2;
  const rows = 2;
  const tilesTop = y - rows * TILE_HEIGHT - TILE_GAP + 24;
  data.tiles.forEach(([value, label], index) => {
    const x = PADDING + (index % 2) * (tileWidth + TILE_GAP);
    const top = tilesTop + Math.floor(index / 2) * (TILE_HEIGHT + TILE_GAP);
    ctx.fillStyle = tile;
    ctx.beginPath();
    ctx.roundRect(x, top, tileWidth, TILE_HEIGHT, 36);
    ctx.fill();
    ctx.fillStyle = tileInk;
    ctx.font = `800 60px ${font}`;
    ctx.fillText(fitText(ctx, value, tileWidth - 72), x + 36, top + 82);
    ctx.font = `500 30px ${font}`;
    ctx.fillText(fitText(ctx, label, tileWidth - 72), x + 36, top + 130);
  });

  ctx.fillStyle = ink;
  ctx.font = `500 34px ${font}`;
  ctx.fillText(getString("recap_total_time"), PADDING, tilesTop - 32);
  ctx.font = `900 112px ${font}`;
  const figureBaseline = tilesTop - 84;
  ctx.fillText(fitText(ctx, data.totalTime, contentWidth), PADDING, figureBaseline);

  // The two faces fill what the words leave, so the card has no hole in the middle.
  const room = figureBaseline - 112 - HEADER_BOTTOM - 2 * TILE_GAP;
  const faces = [data.channelName, data.artistName].filter(Boolean).length;
  const across = faces > 1 ? contentWidth / (2 - PORTRAIT_OVERLAP) : contentWidth;
  const size = Math.min(MAX_PORTRAIT, room, across);
  const portraitsY = HEADER_BOTTOM + TILE_GAP + (room - size) / 2;
  let portraitX = PADDING;
  if (data.channelName) {
    drawPortrait(ctx, images.channel, data.channelName, portraitX, portraitsY, size, tile, tileInk, font);
    portraitX += size * (1 - PORTRAIT_OVERLAP);
  }
  if (data.artistName) drawPortrait(ctx, images.artist, data.artistName, portraitX, portraitsY, size, ink, ground, font);
}

/** An image the canvas may read back, through the local proxy that allows it; null if it won't load. */
export async function loadPosterImage(url: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!url) return null;
  try {
    const routed = proxiedImage(url, useImageProxyStore.getState().base);
    const src = routed !== url ? routed : await proxyImageUrl(url);
    return await new Promise((resolve) => {
      const image = new Image();
      const timeout = setTimeout(() => resolve(null), LOAD_TIMEOUT_MS);
      image.crossOrigin = "anonymous";
      image.onload = () => {
        clearTimeout(timeout);
        resolve(image);
      };
      image.onerror = () => {
        clearTimeout(timeout);
        resolve(null);
      };
      image.src = src;
    });
  } catch {
    return null;
  }
}

/** Draws the poster and encodes it. A portrait that can't be read back never loses the poster. */
export async function renderPosterBlob(
  data: PosterData,
  images: { channel: HTMLImageElement | null; artist: HTMLImageElement | null },
  palette: PosterPalette,
): Promise<Blob | null> {
  const encode = (withImages: typeof images) =>
    new Promise<Blob | null>((resolve) => {
      const canvas = document.createElement("canvas");
      canvas.width = POSTER_WIDTH;
      canvas.height = POSTER_HEIGHT;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      try {
        drawPoster(ctx, data, withImages, palette);
        canvas.toBlob(resolve, "image/png");
      } catch {
        resolve(null);
      }
    });
  return (await encode(images)) ?? (await encode({ channel: null, artist: null }));
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the image"));
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}
