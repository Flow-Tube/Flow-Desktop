import { memo, useLayoutEffect, useRef, type CSSProperties } from "react";

import type { Rgb } from "../../../lib/useDominantColor";
import type { KaraokeGeometry } from "../../../lib/lyrics/display/karaoke";
import { KaraokeSurface, karaokePadding } from "../../../lib/lyrics/display/karaokeSurface";
import type { LyricsAlign } from "../../../lib/lyrics/display/presentation";
import type { RowMotion } from "../../../lib/lyrics/display/rowMotion";
import {
  ROMANIZATION_GAP,
  ROW_PADDING_X,
  TRANSLATION_GAP,
  type LineLayout,
} from "../../../lib/lyrics/display/rowLayout";
import { DOT_GAP, DOT_SIZE } from "../../../lib/lyrics/display/indicator";
import type { TextBlock } from "../../../lib/lyrics/display/textLayout";

const rgb = (c: Rgb): string => `rgb(${c.r},${c.g},${c.b})`;

const ORIGIN: Record<LyricsAlign, string> = { left: "0% 50%", center: "50% 50%", right: "100% 50%" };

/** Rows laid out by the shared text layout, so they wrap exactly as the karaoke canvas does. */
function TextRows({ block, align, color }: { block: TextBlock; align: LyricsAlign; color: string }) {
  const natural = block.height - (block.rows.length - 1) * block.lineHeight;
  return (
    <div className="relative" style={{ height: block.height }}>
      {block.rows.map((row, i) => (
        <div
          key={row.start}
          className="absolute inset-x-0 whitespace-pre"
          style={{
            top: i * block.lineHeight,
            height: natural,
            lineHeight: `${natural}px`,
            font: block.font,
            color,
            textAlign: align,
            direction: row.rtl ? "rtl" : "ltr",
          }}
        >
          {row.text}
        </div>
      ))}
    </div>
  );
}

export interface KaraokeCanvasProps {
  lineIndex: number;
  geometry: KaraokeGeometry;
  width: number;
  height: number;
  textSize: number;
  accent: Rgb;
  unsungAlpha: number;
  glow: boolean;
  motion: boolean;
  /** Bumped when the pixel ratio changes, so the backing store is resized. */
  pixelRatioVersion: number;
  register: (lineIndex: number, surface: KaraokeSurface | null) => void;
}

function KaraokeCanvas(props: KaraokeCanvasProps) {
  const { lineIndex, geometry, width, height, textSize, accent, unsungAlpha, glow, motion, pixelRatioVersion, register } = props;
  const ref = useRef<HTMLCanvasElement | null>(null);
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const surface = new KaraokeSurface(canvas, { geometry, width, height, textSize, accent, unsungAlpha, glow, motion });
    register(lineIndex, surface);
    return () => register(lineIndex, null);
  }, [lineIndex, geometry, width, height, textSize, accent, unsungAlpha, glow, motion, pixelRatioVersion, register]);
  const pad = karaokePadding(textSize);
  return (
    <div className="relative" style={{ height }}>
      <canvas ref={ref} aria-hidden className="pointer-events-none absolute" style={{ left: -pad.x, top: -pad.y }} />
    </div>
  );
}

export interface LineRowProps {
  listIndex: number;
  lineIndex: number;
  layout: LineLayout;
  align: LyricsAlign;
  accent: Rgb;
  left: number;
  rowWidth: number;
  /** False for a background line between its showings: only its padding takes room. */
  mounted: boolean;
  interactive: boolean;
  focused: boolean;
  romanization: string | null;
  translation: string | null;
  karaoke: Omit<KaraokeCanvasProps, "lineIndex" | "width" | "height" | "textSize" | "accent"> | null;
  motion: RowMotion;
  /** The manual scroll at render time, so a re-rendered row lands where the frame loop has it. */
  manualOffset: number;
  onLineClick: (lineIndex: number) => void;
}

/** One lyric line: its springs write straight to this element, so frames never re-render it. */
export const LineRow = memo(function LineRow(props: LineRowProps) {
  const { listIndex, lineIndex, layout, align, accent, left, rowWidth, mounted, interactive, focused, karaoke, motion, manualOffset, onLineClick } =
    props;
  const secondaryRefs = useRef<HTMLElement[]>([]);
  const innerWidth = rowWidth - ROW_PADDING_X * 2;
  const columnLeft =
    ROW_PADDING_X + (align === "left" ? 0 : align === "right" ? innerWidth - layout.columnWidth : (innerWidth - layout.columnWidth) / 2);
  const color = rgb(accent);
  const style: CSSProperties = {
    left,
    width: rowWidth,
    height: mounted ? layout.height : layout.paddingTop + layout.paddingBottom,
    transformOrigin: ORIGIN[align],
  };
  secondaryRefs.current = [];
  const collect = (node: HTMLDivElement | null) => {
    if (node) secondaryRefs.current.push(node);
  };

  return (
    <div
      ref={(node) => {
        motion.attach(node, secondaryRefs.current);
        motion.write(manualOffset);
      }}
      data-lyric-row={listIndex}
      aria-hidden
      onClick={interactive ? () => onLineClick(lineIndex) : undefined}
      className={`absolute top-0 rounded-lg will-change-transform ${
        interactive ? "cursor-pointer transition-colors duration-200 ease-out hover:bg-chrome-neutral-100/5" : ""
      } ${focused ? "ring-2 ring-[var(--color-primary)]" : ""}`}
      style={style}
    >
      {mounted && (
        <div className="absolute" style={{ left: columnLeft, top: layout.paddingTop, width: layout.columnWidth }}>
          {karaoke ? (
            <KaraokeCanvas
              {...karaoke}
              lineIndex={lineIndex}
              width={layout.columnWidth}
              height={layout.main.height}
              textSize={layout.textSize}
              accent={accent}
            />
          ) : (
            <TextRows block={layout.main} align={align} color={color} />
          )}
          {layout.romanization && (
            <div ref={collect} style={{ marginTop: ROMANIZATION_GAP }}>
              <TextRows block={layout.romanization} align={align} color={color} />
            </div>
          )}
          {layout.translation && (
            <div ref={collect} style={{ marginTop: TRANSLATION_GAP }}>
              <TextRows block={layout.translation} align={align} color={color} />
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export interface IndicatorRowProps {
  listIndex: number;
  left: number;
  rowWidth: number;
  color: Rgb;
  label: string;
  motion: RowMotion;
  manualOffset: number;
  registerDots: (listIndex: number, dots: HTMLElement[] | null) => void;
}

/** An instrumental break: three dots, moved by the panel's frame loop. */
export const IndicatorRow = memo(function IndicatorRow(props: IndicatorRowProps) {
  const { listIndex, left, rowWidth, color, label, motion, manualOffset, registerDots } = props;
  const dots = useRef<HTMLElement[]>([]);
  useLayoutEffect(() => {
    registerDots(listIndex, dots.current);
    return () => registerDots(listIndex, null);
  }, [listIndex, registerDots]);
  return (
    <div
      ref={(node) => {
        motion.attach(node);
        motion.write(manualOffset);
      }}
      role="img"
      aria-label={label}
      className="absolute top-0 flex items-center justify-center overflow-visible"
      style={{ left, width: rowWidth, gap: DOT_GAP }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          ref={(node) => {
            if (node) dots.current[i] = node;
          }}
          className="block rounded-full"
          style={{ width: DOT_SIZE, height: DOT_SIZE, backgroundColor: rgb(color) }}
        />
      ))}
    </div>
  );
});
