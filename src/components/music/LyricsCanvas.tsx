import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw } from "lucide-react";

import type { LyricsEntry, WordTimestamp } from "../../lib/lyrics/types";
import type { Rgb } from "../../lib/useDominantColor";
import { findCurrentLineIndex } from "../../lib/lyrics/lyricsUtils";
import { musicAudioEngine } from "../../lib/audio/musicAudioEngine";
import { getString } from "../../lib/i18n/index";

const ANCHOR_RATIO = 0.35;
const LINE_SPACING = 1.18;
const LINE_GAP = 16;
const LINE_BLOCK_PAD = 8;
const GAP_BLOCK_H = 72;
const BASE_FONT_PX = 40;
const FOCUSED_ALPHA = 0.45;
const PREVIEW_RESYNC_MS = 8000;
const SCROLL_LERP = 0.2;
const VISUAL_LERP = 0.28;
const GAP_LERP = 0.24;
const POSITION_LERP = 0.42;
const SEEK_SNAP_MS = 1200;

const rgba = (c: Rgb, a: number) => `rgba(${c.r},${c.g},${c.b},${a})`;
const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * clamp(t)) - 1) / 2;

interface GraphemeSegmenter {
  segment(input: string): Iterable<{ segment: string }>;
}
let segmenter: GraphemeSegmenter | null = null;
function graphemes(str: string): string[] {
  const intl = Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => GraphemeSegmenter };
  if (intl.Segmenter) {
    if (!segmenter) segmenter = new intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(str), (s) => s.segment);
  }
  return Array.from(str);
}

function adaptiveFontPx(textLength: number, isBackground: boolean): number {
  const size =
    textLength > 92 ? BASE_FONT_PX * 0.66
    : textLength > 72 ? BASE_FONT_PX * 0.72
    : textLength > 54 ? BASE_FONT_PX * 0.8
    : textLength > 42 ? BASE_FONT_PX * 0.9
    : BASE_FONT_PX;
  return isBackground ? size * 0.7 : size;
}

interface Cluster {
  ch: string;
  x: number;
  w: number;
  word: number;
  charInWord: number;
  wordLen: number;
}
interface Row {
  clusters: Cluster[];
  width: number;
  text: string;
}
interface LineVisual {
  scale: number;
  alpha: number;
  blur: number;
  y: number;
}
interface GapVisual {
  height: number;
  alpha: number;
}
type Item =
  | {
      kind: "line";
      lineIndex: number;
      rows: Row[];
      blockHeight: number;
      fontPx: number;
      font: string;
      isBackground: boolean;
      words: WordTimestamp[] | null;
      empty: boolean;
    }
  | { kind: "gap"; blockHeight: number; start: number; end: number };
interface Layout {
  items: Item[];
  tops: number[];
  lineToItem: number[];
}

const displayText = (entry: LyricsEntry): string =>
  entry.isBackground ? entry.text.replace(/^\(/, "").replace(/\)$/, "") : entry.text;

const fontFor = (fontPx: number, isBg: boolean): string =>
  `${isBg ? "italic " : ""}800 ${fontPx}px Inter, system-ui, sans-serif`;

function gapBetween(current: Item, next: Item): number {
  if (current.kind === "gap" || next.kind === "gap") return 0;
  if (current.isBackground || next.isBackground) return 0;
  return LINE_GAP;
}

function isGapVisible(item: Extract<Item, { kind: "gap" }>, pos: number, manual: boolean): boolean {
  return !manual && pos >= item.start && pos <= item.end - 650;
}

function measure(ctx: CanvasRenderingContext2D, lines: LyricsEntry[], maxWidth: number): Layout {
  const items: Item[] = [];
  const lineToItem: number[] = [];

  const push = (item: Item) => {
    items.push(item);
  };

  lines.forEach((entry, lineIndex) => {
    const text = displayText(entry);
    const isBg = !!entry.isBackground;
    const fontPx = adaptiveFontPx(text.length, isBg);
    const font = fontFor(fontPx, isBg);
    lineToItem[lineIndex] = items.length;

    if (text.trim().length === 0) {
      push({ kind: "line", lineIndex, rows: [], blockHeight: 6, fontPx, font, isBackground: isBg, words: null, empty: true });
    } else {
      ctx.font = font;
      const spaceW = ctx.measureText(" ").width;
      const words = entry.words && entry.words.length > 0 ? entry.words : null;
      const tokens = words ? words.map((w) => w.text) : text.split(/\s+/).filter(Boolean);

      const rows: Row[] = [];
      let cur: Cluster[] = [];
      let curW = 0;
      tokens.forEach((tok, wi) => {
        const g = graphemes(tok);
        const gc: Cluster[] = g.map((ch, ci) => ({
          ch,
          x: 0,
          w: ctx.measureText(ch).width,
          word: words ? wi : -1,
          charInWord: ci,
          wordLen: g.length,
        }));
        const wordW = gc.reduce((s, c) => s + c.w, 0);
        if (cur.length > 0 && curW + spaceW + wordW > maxWidth) {
          rows.push({ clusters: cur, width: curW, text: cur.map((c) => c.ch).join("") });
          cur = [];
          curW = 0;
        }
        if (cur.length > 0) {
          cur.push({ ch: " ", x: curW, w: spaceW, word: -1, charInWord: 0, wordLen: 1 });
          curW += spaceW;
        }
        gc.forEach((c) => {
          c.x = curW;
          curW += c.w;
          cur.push(c);
        });
      });
      if (cur.length > 0) rows.push({ clusters: cur, width: curW, text: cur.map((c) => c.ch).join("") });
      const blockHeight = Math.max(1, rows.length) * fontPx * LINE_SPACING + LINE_BLOCK_PAD * 2;
      push({ kind: "line", lineIndex, rows, blockHeight, fontPx, font, isBackground: isBg, words, empty: false });
    }

    // Instrumental gap → a breathing slot with a converging indicator.
    const next = lines[lineIndex + 1];
    if (next) {
      const curEnd = entry.words?.length
        ? entry.words[entry.words.length - 1]!.endTime
        : text.trim() === ""
          ? entry.time
          : null;
      if (curEnd != null && next.time - curEnd > 4000) {
        push({ kind: "gap", blockHeight: GAP_BLOCK_H, start: curEnd, end: next.time });
      }
    }
  });

  const tops: number[] = [];
  let y = 0;
  items.forEach((item, idx) => {
    tops[idx] = y;
    const next = items[idx + 1];
    y += item.blockHeight + (next ? gapBetween(item, next) : 0);
  });

  return { items, tops, lineToItem };
}

export function LyricsCanvas({
  lines,
  accent,
  onSeek,
  className = "",
}: {
  lines: LyricsEntry[];
  accent: Rgb;
  onSeek: (seconds: number) => void;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const layoutRef = useRef<Layout | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const offsetRef = useRef(0);
  const currentTopsRef = useRef<number[]>([]);
  const currentHeightsRef = useRef<number[]>([]);
  const initializedRef = useRef(false);
  const modeRef = useRef<"auto" | "manual">("auto");
  const resyncTimer = useRef<number | null>(null);
  const smoothPositionRef = useRef(0);
  const animRef = useRef<Map<number, LineVisual>>(new Map());
  const gapAnimRef = useRef<Map<number, GapVisual>>(new Map());
  const [manual, setManual] = useState(false);

  const relayout = () => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const cssW = wrap.clientWidth;
    const cssH = wrap.clientHeight;
    if (cssW === 0 || cssH === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sizeRef.current = { w: cssW, h: cssH };
    layoutRef.current = measure(ctx, lines, cssW * 0.84);
    animRef.current.clear();
    gapAnimRef.current.clear();
    currentTopsRef.current = [];
    currentHeightsRef.current = [];
    initializedRef.current = false;
  };

  useEffect(() => {
    relayout();
    let frame: number | null = null;
    let disposed = false;
    const scheduleLayout = () => {
      if (disposed || frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        relayout();
      });
    };
    const ro = new ResizeObserver(scheduleLayout);
    if (wrapRef.current) ro.observe(wrapRef.current);
    if (typeof document !== "undefined" && document.fonts?.ready) {
      void document.fonts.ready.then(scheduleLayout);
    }
    return () => {
      disposed = true;
      ro.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [lines]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [accent, lines]);

  useEffect(
    () => () => {
      if (resyncTimer.current) window.clearTimeout(resyncTimer.current);
    },
    [],
  );

  function computeTops(layout: Layout, pos: number, isManual: boolean): { tops: number[]; heights: number[] } {
    const tops: number[] = [];
    const heights: number[] = [];
    let y = 0;

    layout.items.forEach((item, idx) => {
      tops[idx] = y;
      let height = item.blockHeight;
      if (item.kind === "gap") {
        const visible = isGapVisible(item, pos, isManual);
        let g = gapAnimRef.current.get(idx);
        if (!g) {
          g = { height: 0, alpha: 0 };
          gapAnimRef.current.set(idx, g);
        }
        const targetHeight = visible || g.alpha > 0.05 ? item.blockHeight : 0;
        const targetAlpha = visible && g.height > item.blockHeight * 0.82 ? 1 : 0;
        g.height += (targetHeight - g.height) * GAP_LERP;
        g.alpha += (targetAlpha - g.alpha) * GAP_LERP;
        if (Math.abs(g.height - targetHeight) < 0.35) g.height = targetHeight;
        if (Math.abs(g.alpha - targetAlpha) < 0.01) g.alpha = targetAlpha;
        height = g.height;
      }
      heights[idx] = height;
      const next = layout.items[idx + 1];
      y += height + (next ? gapBetween(item, next) : 0);
    });

    currentTopsRef.current = tops;
    currentHeightsRef.current = heights;
    return { tops, heights };
  }

  function draw() {
    const canvas = canvasRef.current;
    const layout = layoutRef.current;
    if (!canvas || !layout) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w: cssW, h: cssH } = sizeRef.current;
    const rawPos = musicAudioEngine.getCurrentTime() * 1000;
    if (!initializedRef.current || Math.abs(rawPos - smoothPositionRef.current) > SEEK_SNAP_MS) {
      smoothPositionRef.current = rawPos;
    } else {
      smoothPositionRef.current += (rawPos - smoothPositionRef.current) * POSITION_LERP;
    }
    const pos = smoothPositionRef.current;
    const anchorY = cssH * ANCHOR_RATIO;
    const isManual = modeRef.current === "manual";
    const active = Math.max(0, findCurrentLineIndex(lines, rawPos));
    const { tops, heights } = computeTops(layout, rawPos, isManual);
    const activeItem = layout.lineToItem[active] ?? 0;
    const activeTop = tops[activeItem] ?? 0;
    const activeBlock = heights[activeItem] || layout.items[activeItem]?.blockHeight || 0;

    const target = activeTop + activeBlock / 2 - anchorY;
    if (modeRef.current === "auto") {
      if (!initializedRef.current) {
        offsetRef.current = target;
        initializedRef.current = true;
      } else {
        offsetRef.current += (target - offsetRef.current) * SCROLL_LERP;
      }
    }
    const offset = offsetRef.current;

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.textBaseline = "middle";
    const now = Date.now();

    layout.items.forEach((item, idx) => {
      const itemHeight = heights[idx] ?? item.blockHeight;
      const targetTop = (tops[idx] ?? 0) - offset;
      if (targetTop + itemHeight < -80 || targetTop > cssH + 80) return;

      if (item.kind === "gap") {
        const g = gapAnimRef.current.get(idx);
        if (g && g.height > 0.5 && g.alpha > 0.01) drawGap(ctx, item, cssW, targetTop, itemHeight, rawPos, g.alpha);
        return;
      }
      if (item.empty) return;

      const dist = Math.abs(item.lineIndex - active);
      // While manually scrolling: everything readable (no blur, no emphasis).
      const isActive = !isManual && item.lineIndex === active;
      const tScale = isManual ? 0.965 : isActive ? 1.075 : 0.92;
      const tBlur = isManual || isActive || item.isBackground ? 0 : Math.min(dist * 4, 16);
      const tAlpha = isManual ? 0.85 : isActive ? 1 : dist === 1 ? 0.5 : dist === 2 ? 0.42 : dist === 3 ? 0.34 : 0.25;

      // Ease toward the targets (≈500ms feel) so scale/blur/alpha never snap.
      let a = animRef.current.get(item.lineIndex);
      if (!a) {
        a = { scale: tScale, alpha: tAlpha, blur: tBlur, y: targetTop };
        animRef.current.set(item.lineIndex, a);
      } else {
        const distanceDelay = Math.min(dist * 0.012, 0.08);
        const lerp = isActive ? 0.42 : Math.max(0.12, VISUAL_LERP - distanceDelay);
        a.scale += (tScale - a.scale) * lerp;
        a.alpha += (tAlpha - a.alpha) * lerp;
        a.blur += (tBlur - a.blur) * lerp;
        a.y += (targetTop - a.y) * Math.max(0.2, lerp);
      }

      const rowH = item.fontPx * LINE_SPACING;
      const top = a.y;
      const centerYBlock = top + item.blockHeight / 2;

      ctx.save();
      ctx.filter = a.blur > 0.35 ? `blur(${a.blur.toFixed(2)}px)` : "none";
      ctx.globalAlpha = a.alpha;
      ctx.translate(cssW / 2, centerYBlock);
      ctx.scale(a.scale, a.scale);
      ctx.translate(-cssW / 2, -centerYBlock);
      ctx.font = item.font;

      item.rows.forEach((row, ri) => {
        const rowCenterY = top + LINE_BLOCK_PAD + ri * rowH + rowH / 2;
        if (isActive && item.words) {
          drawActiveRow(ctx, row, item.words, item.fontPx, cssW, rowCenterY, pos, now);
        } else {
          ctx.textAlign = "center";
          ctx.fillStyle = rgba(accent, 1);
          ctx.fillText(row.text, cssW / 2, rowCenterY);
        }
      });
      ctx.globalAlpha = 1;
      ctx.restore();
    });
  }

  function drawGap(
    ctx: CanvasRenderingContext2D,
    item: Extract<Item, { kind: "gap" }>,
    cssW: number,
    top: number,
    height: number,
    pos: number,
    alpha: number,
  ) {
    const end = item.end - 650;
    const rawProgress = end > item.start ? clamp((pos - item.start) / (end - item.start)) : 0;
    const progress = easeInOutSine(rawProgress);
    const fade = alpha * clamp((pos - item.start) / 180);
    const cy = top + height / 2;
    const trackW = Math.min(360, cssW * 0.5);
    const left = cssW / 2 - trackW / 2;

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.textAlign = "center";
    ctx.font = "700 13px Inter, system-ui, sans-serif";
    ctx.fillStyle = rgba(accent, 0.85 * (1 - progress));
    ctx.fillText("I N S T R U M E N T A L", cssW / 2, cy - 22);

    // Dim track.
    ctx.fillStyle = rgba(accent, 0.15);
    roundRect(ctx, left, cy - 2, trackW, 4, 2);
    ctx.fill();
    // Converging bright segment + end dots.
    const segHalf = (trackW / 2) * (1 - progress);
    ctx.fillStyle = rgba(accent, 0.95);
    roundRect(ctx, cssW / 2 - segHalf, cy - 2, segHalf * 2, 4, 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${0.8 * (1 - progress)})`;
    ctx.beginPath();
    ctx.arc(cssW / 2 - segHalf, cy, 4, 0, Math.PI * 2);
    ctx.arc(cssW / 2 + segHalf, cy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawActiveRow(
    ctx: CanvasRenderingContext2D,
    row: Row,
    words: WordTimestamp[],
    fontPx: number,
    cssW: number,
    rowCenterY: number,
    pos: number,
    now: number,
  ) {
    const rowOffsetX = cssW / 2 - row.width / 2;
    ctx.textAlign = "left";

    const shimmer = (now % 3000) / 3000;
    const span = Math.max(1, row.width);
    const gx = rowOffsetX + span * shimmer;
    const liquid = ctx.createLinearGradient(gx - span / 2, 0, gx + span / 2, 0);
    liquid.addColorStop(0, rgba(accent, 1));
    liquid.addColorStop(0.5, "rgba(255,255,255,0.85)");
    liquid.addColorStop(1, rgba(accent, 1));

    const visual = row.clusters.map((c) => {
      const w = c.word >= 0 ? words[c.word] : undefined;
      if (!w) return { cluster: c, word: undefined, sung: false, sungFactor: 0, charLp: 0, sx: 1, sy: 1, y: 0 };
      const dur = Math.max(100, w.endTime - w.startTime);
      const wordProgress = (pos - w.startTime) / dur;
      const sung = pos > w.endTime;
      const sungFactor = sung ? 1 : pos >= w.startTime ? easeInOutSine((pos - w.startTime) / dur) : 0;
      const charLp = clamp((wordProgress - c.charInWord / c.wordLen) * c.wordLen);
      const since = pos - w.startTime;
      const anticipation = since >= -70 && since < 0 ? -0.008 * Math.sin(((since + 70) / 70) * Math.PI) : 0;
      const impact = since >= 0 && since < 680 ? Math.sin(clamp(since / 680) * Math.PI) * Math.exp(-since / 950) : 0;
      const nudge = !sung && charLp > 0 ? 0.034 * Math.sin(charLp * Math.PI) * Math.exp(-2.6 * charLp) : 0;
      return {
        cluster: c,
        word: w,
        sung,
        sungFactor,
        charLp,
        sx: 1 + anticipation + impact * 0.026 + nudge * 0.28,
        sy: 1 + anticipation + impact * 0.018 + nudge,
        y: since >= 0 && since < 420 ? -Math.sin(clamp(since / 420) * Math.PI) * 1.8 : 0,
      };
    });
    const totalPush = visual.reduce((sum, v) => sum + v.cluster.w * (v.sx - 1), 0);
    let pushX = -totalPush / 2;

    for (const v of visual) {
      const c = v.cluster;
      if (!v.word) {
        pushX += c.w * (v.sx - 1);
        continue;
      }
      const x = rowOffsetX + c.x + pushX;
      const sung = v.sung;
      const sungFactor = v.sungFactor;
      const charLp = v.charLp;
      const y = rowCenterY + v.y;

      ctx.save();
      ctx.translate(x + c.w / 2, y + fontPx * 0.24);
      ctx.scale(v.sx, v.sy);
      ctx.translate(-(x + c.w / 2), -(y + fontPx * 0.24));

      if (sung || charLp >= 0.999) {
        ctx.fillStyle = liquid;
        ctx.fillText(c.ch, x, y);
      } else {
        ctx.fillStyle = rgba(accent, FOCUSED_ALPHA + (1 - FOCUSED_ALPHA) * sungFactor);
        ctx.fillText(c.ch, x, y);
        if (charLp > 0) {
          const fillX = c.w * easeOutCubic(charLp);
          const edge = Math.max(1, c.w * 0.45);
          const solid = Math.max(0, fillX - edge);
          const clipTop = y - fontPx * 0.75;
          const clipH = fontPx * 1.5;
          if (solid > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, clipTop, solid, clipH);
            ctx.clip();
            ctx.shadowColor = rgba(accent, 0.4);
            ctx.shadowBlur = fontPx * 0.3;
            ctx.fillStyle = liquid;
            ctx.fillText(c.ch, x, y);
            ctx.restore();
          }
          for (let j = 0; j < 12; j++) {
            const s = solid + (j * edge) / 12;
            const e = Math.min(fillX, solid + ((j + 1) * edge) / 12);
            if (e <= s) continue;
            ctx.save();
            ctx.beginPath();
            ctx.rect(x + s, clipTop, e - s, clipH);
            ctx.clip();
            ctx.fillStyle = rgba(accent, 1 - (j + 0.5) / 12);
            ctx.fillText(c.ch, x, y);
            ctx.restore();
          }
        }
      }
      ctx.restore();
      pushX += c.w * (v.sx - 1);
    }
  }

  const scheduleResync = () => {
    if (resyncTimer.current) window.clearTimeout(resyncTimer.current);
    resyncTimer.current = window.setTimeout(() => {
      modeRef.current = "auto";
      setManual(false);
    }, PREVIEW_RESYNC_MS);
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const layout = layoutRef.current;
    if (!layout) return;
    const { h } = sizeRef.current;
    const anchorY = h * ANCHOR_RATIO;
    const lastIdx = layout.items.length - 1;
    const tops = currentTopsRef.current.length ? currentTopsRef.current : layout.tops;
    const heights = currentHeightsRef.current;
    const contentBottom = (tops[lastIdx] ?? 0) + (heights[lastIdx] ?? layout.items[lastIdx]?.blockHeight ?? 0);
    // offset = top_i - anchorY puts line i at the anchor; allow first→last + slack.
    const min = -anchorY - 120;
    const max = contentBottom - anchorY + 120;
    offsetRef.current = Math.max(min, Math.min(max, offsetRef.current + e.deltaY));
    modeRef.current = "manual";
    setManual(true);
    scheduleResync();
  };

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const layout = layoutRef.current;
    const wrap = wrapRef.current;
    if (!layout || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const contentY = e.clientY - rect.top + offsetRef.current;
    const tops = currentTopsRef.current.length ? currentTopsRef.current : layout.tops;
    const heights = currentHeightsRef.current;
    for (let i = 0; i < layout.items.length; i++) {
      const item = layout.items[i]!;
      if (item.kind !== "line" || item.empty) continue;
      const top = tops[i]!;
      const height = heights[i] ?? item.blockHeight;
      if (contentY >= top && contentY <= top + height) {
        onSeek(Math.max(0, lines[item.lineIndex]!.time / 1000));
        modeRef.current = "auto";
        setManual(false);
        return;
      }
    }
  };

  const resyncNow = () => {
    if (resyncTimer.current) window.clearTimeout(resyncTimer.current);
    modeRef.current = "auto";
    setManual(false);
  };

  const fadeMask = "linear-gradient(to bottom, transparent 0%, #000 15%, #000 80%, transparent 100%)";
  return (
    <div ref={wrapRef} onWheel={onWheel} onClick={onClick} className={`relative ${className}`}>
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        style={{ maskImage: fadeMask, WebkitMaskImage: fadeMask }}
      />
      <AnimatePresence>
        {manual && (
          <motion.button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              resyncNow();
            }}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="absolute left-1/2 top-24 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-chrome-black/60 px-4 py-2 text-sm font-medium"
            style={{ color: rgba(accent, 1) }}
          >
            <RefreshCw className="h-4 w-4" />
            {getString("music_resync")}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
