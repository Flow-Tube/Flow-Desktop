import type { LyricsEntry, WordTimestamp } from "../../../lib/lyrics/types";
import type { Rgb } from "../../../lib/useDominantColor";
import type { KaraokeGeometry } from "../../../lib/lyrics/display/karaoke";
import type { KaraokeSurface } from "../../../lib/lyrics/display/karaokeSurface";
import type { LyricsPresentation } from "../../../lib/lyrics/display/presentation";
import type { RowLayout } from "../../../lib/lyrics/display/rowLayout";
import type { RowMotion } from "../../../lib/lyrics/display/rowMotion";
import { isLineActive, rowTarget, type TargetContext } from "../../../lib/lyrics/display/panelLayout";
import { IS_LINUX_RUNTIME } from "../../../lib/platform";
import { getString } from "../../../lib/i18n/index";
import { IndicatorRow, LineRow } from "./LyricsRows";

export type { DotsHandle } from "./indicatorDots";

/** Lines this close to the sung one draw on the karaoke canvas, so becoming active never re-lays them out. */
const KARAOKE_WINDOW = 1;
const FOCUSED_ALPHA = 0.45;
const BACKGROUND_UNSUNG_ALPHA = 0.6;

export interface LyricsRowListProps {
  rendered: number[];
  motions: Map<number, RowMotion>;
  ctx: TargetContext;
  layouts: RowLayout[];
  lines: LyricsEntry[];
  lineWords: WordTimestamp[][];
  presentation: LyricsPresentation;
  geometryFor: (lineIndex: number, listIndex: number) => KaraokeGeometry | null;
  expressiveAccent: Rgb;
  rowLeft: number;
  rowWidth: number;
  focusedLine: number | null;
  motionEnabled: boolean;
  pixelRatioVersion: number;
  onLineClick: (lineIndex: number) => void;
  registerSurface: (lineIndex: number, surface: KaraokeSurface | null) => void;
  registerDots: (listIndex: number, dots: HTMLElement[] | null) => void;
}

/** The rows that exist this render, each placed and moved by its own springs. */
export function LyricsRowList(props: LyricsRowListProps) {
  const { rendered, motions, ctx, layouts, lines, lineWords, presentation, geometryFor, expressiveAccent } = props;
  const { rowLeft, rowWidth, focusedLine, motionEnabled, pixelRatioVersion, onLineClick, registerSurface, registerDots } = props;
  const manualOffset = ctx.state.userManualOffset;
  return (
    <>
      {rendered.map((listIndex) => {
        const item = ctx.items[listIndex]!;
        const layout = layouts[listIndex];
        const motion = motions.get(listIndex);
        if (!layout || !motion) return null;
        if (item.kind === "indicator") {
          return (
            <IndicatorRow
              key={`i${listIndex}`}
              listIndex={listIndex}
              left={rowLeft}
              rowWidth={rowWidth}
              color={expressiveAccent}
              label={getString("music_lyrics_instrumental")}
              motion={motion}
              manualOffset={manualOffset}
              registerDots={registerDots}
            />
          );
        }
        if (layout.kind !== "line") return null;
        const lineIndex = item.index;
        const distance = Math.abs(lineIndex - ctx.state.deferredCurrentLineIndex);
        const words = lineWords[lineIndex] ?? [];
        const inKaraoke = ctx.isSynced && words.length > 0 && (isLineActive(ctx, lineIndex) || distance <= KARAOKE_WINDOW);
        const geometry = inKaraoke ? geometryFor(lineIndex, listIndex) : null;
        const look = presentation.looks[lineIndex]!;
        return (
          <LineRow
            key={`l${listIndex}`}
            listIndex={listIndex}
            lineIndex={lineIndex}
            layout={layout}
            align={look.align}
            accent={look.accent}
            left={rowLeft}
            rowWidth={rowWidth}
            mounted={rowTarget(ctx, listIndex).presence || motion.presence.value > 0}
            interactive={ctx.isSynced}
            focused={focusedLine === lineIndex}
            romanization={presentation.romanizations[lineIndex] ?? null}
            translation={lines[lineIndex]?.translation ?? null}
            motion={motion}
            manualOffset={manualOffset}
            onLineClick={onLineClick}
            karaoke={
              geometry
                ? {
                    geometry,
                    unsungAlpha: item.entry.isBackground ? BACKGROUND_UNSUNG_ALPHA : FOCUSED_ALPHA,
                    // WebKitGTK draws canvas shadows on the CPU, so the held-note glow stays off on Linux.
                    glow: !IS_LINUX_RUNTIME,
                    motion: motionEnabled,
                    pixelRatioVersion,
                    register: registerSurface,
                  }
                : null
            }
          />
        );
      })}
    </>
  );
}
