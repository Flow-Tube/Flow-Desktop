import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useReducedMotion } from "framer-motion";
import { Loader2 } from "lucide-react";

import type { LyricsEntry } from "../../../lib/lyrics/types";
import type { Rgb } from "../../../lib/useDominantColor";
import { entriesAreSynced } from "../../../lib/lyrics/sync";
import { buildLines, buildMergedLyricsList } from "../../../lib/lyrics/display/model";
import { LyricsPanelState, mainLineAt } from "../../../lib/lyrics/display/panelState";
import { lyricsMaxScrollOffset, lyricsMinScrollOffset, lyricsRowOffsets } from "../../../lib/lyrics/display/scrollMath";
import { lyricsPresentation, lyricsRomanizations, readableAccent, type LyricsAlign } from "../../../lib/lyrics/display/presentation";
import type { KaraokeSurface } from "../../../lib/lyrics/display/karaokeSurface";
import { layoutRows, type RowLayout } from "../../../lib/lyrics/display/rowLayout";
import { RowMotion } from "../../../lib/lyrics/display/rowMotion";
import {
  ROW_METRICS,
  activeListIndexOf,
  isLineActive,
  presenceAt,
  presenceSet,
  renderedRows,
  rowHeights,
  rowTarget,
  type TargetContext,
} from "../../../lib/lyrics/display/panelLayout";
import { LyricsScroller } from "../../../lib/lyrics/display/scroller";
import { FrameLoop, LyricsClock } from "../../../lib/lyrics/display/clock";
import { IS_LINUX_RUNTIME } from "../../../lib/platform";
import { usePageVisible } from "../../../lib/usePageVisible";
import { getString } from "../../../lib/i18n/index";
import { useMusicPlayerStore } from "../../../store/useMusicPlayerStore";
import { LyricsRowList, type DotsHandle } from "./LyricsRowList";
import { stepDots } from "./indicatorDots";
import { lyricsMeasurer, useKaraokeGeometry, useLineWords } from "./useLyricsGeometry";
import { CurrentLineAnnouncer, LyricsProviderLabel, LyricsResyncButton } from "./LyricsPanelChrome";

const ANCHOR_RATIO = 0.35;
const FADE_TOP = 130;
const FADE_BOTTOM = 160;
const SYNC_TICK_MS = 80;
const BOTTOM_MARGIN = 100;
const TOP_MARGIN = 150;
const SEEK_SLACK_MS = 30_000;
const DEFAULT_FAMILY = "Inter, system-ui, sans-serif";

const fadeMask = `linear-gradient(to bottom, transparent 0, black ${FADE_TOP}px, black calc(100% - ${FADE_BOTTOM}px), transparent 100%)`;

export interface LyricsPanelProps {
  lyrics: string | null;
  syncedLyrics: LyricsEntry[];
  isLoading: boolean;
  providerName: string;
  accent: Rgb;
  /** What the lyrics are drawn over: accents are lifted to read against it. Null keeps the accent. */
  backdrop: Rgb | null;
  baseTextSize: number;
  /** The widest a row gets, so a wide window keeps readable lines. */
  maxRowWidth: number;
  textAlign: LyricsAlign;
  showTranslation: boolean;
  showRomanization: boolean;
  /** Applied inside the sync loops, so a nudge takes effect mid-line. */
  syncOffsetMs: number;
  /** False while the host keeps the panel mounted but hidden: every loop stops. */
  active: boolean;
  isPlaying: boolean;
  /** A tap on a synced line, with the line's own time in ms. */
  onSeekTo: (lineTimeMs: number) => void;
  className?: string;
}

/**
 * Port of Android's InlineLyricsPanel. Rows spring on their own elements and the sung line draws on
 * its canvas from one frame loop; React re-renders only when the sung line or what shows changes.
 */
export function LyricsPanel(props: LyricsPanelProps) {
  const { lyrics, syncedLyrics, isLoading, providerName, accent, backdrop, baseTextSize, maxRowWidth, textAlign } = props;
  const { showTranslation, showRomanization, syncOffsetMs, active, isPlaying, onSeekTo, className = "" } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [family, setFamily] = useState(DEFAULT_FAMILY);
  const [pixelRatioVersion, setPixelRatioVersion] = useState(0);
  const [, setVersion] = useState(0);
  const [focusedLine, setFocusedLine] = useState<number | null>(null);
  const pageVisible = usePageVisible();
  const motionEnabled = !useReducedMotion();
  const running = active && pageVisible;

  const lines = useMemo(() => buildLines(lyrics, syncedLyrics), [lyrics, syncedLyrics]);
  const items = useMemo(() => buildMergedLyricsList(lines), [lines]);
  const hasWordTimings = useMemo(() => lines.some((l) => l.words && l.words.length > 0), [lines]);
  const isSynced = useMemo(
    () => syncedLyrics.length > 0 && entriesAreSynced(syncedLyrics) && lines.some((l) => l.time >= 1 && l.time <= 999_999),
    [lines, syncedLyrics],
  );
  const romanizations = useMemo(() => lyricsRomanizations(lines, showRomanization), [lines, showRomanization]);
  const presentation = useMemo(
    () => lyricsPresentation(lines, accent, backdrop, baseTextSize, textAlign, showTranslation, romanizations),
    [lines, accent, backdrop, baseTextSize, textAlign, showTranslation, romanizations],
  );
  const expressiveAccent = useMemo(() => readableAccent(accent, backdrop), [accent, backdrop]);
  const rowWidth = Math.min(size.width, maxRowWidth);
  const layouts = useMemo<RowLayout[]>(
    () => (rowWidth > 0 ? layoutRows(items, presentation, rowWidth, family, lyricsMeasurer()) : []),
    [items, presentation, rowWidth, family],
  );
  const lineWords = useLineWords(lines, presentation.nextLineTimes);
  const geometryFor = useKaraokeGeometry(lines, layouts, lineWords, presentation);
  const listIndexOfLine = useMemo(() => {
    const map = new Map<number, number>();
    items.forEach((item, i) => {
      if (item.kind === "line") map.set(item.index, i);
    });
    return map;
  }, [items]);

  // Everything the frame loop and the sync tick touch lives in refs, so they never wait on React.
  const rerender = useCallback(() => setVersion((v) => v + 1), []);
  const state = useRef(new LyricsPanelState(0)).current;
  const clock = useRef(new LyricsClock()).current;
  const loop = useRef(new FrameLoop()).current;
  const motions = useRef(new Map<number, RowMotion>());
  const motionList = useRef<RowMotion[]>([]);
  const surfaces = useRef(new Map<number, KaraokeSurface>());
  const surfaceList = useRef<Array<[number, KaraokeSurface]>>([]);
  const dots = useRef(new Map<number, DotsHandle>());
  const presence = useRef({ key: "", set: new Set<number>() });
  const seenVersion = useRef(-1);
  const renderedKey = useRef("");
  const live = useRef({ isPlaying, syncOffsetMs, active, motionEnabled });
  live.current = { isPlaying, syncOffsetMs, active, motionEnabled };
  const scroller = useRef<LyricsScroller | null>(null);
  scroller.current ??= new LyricsScroller(state, (modeChanged) => {
    if (modeChanged || renderedKey.current !== windowKeyRef.current(state.userManualOffset)) rerender();
    loop.wake();
  });
  const scroll = scroller.current;

  // New lyrics or a new layout start over: the state resets, and rows snap to their places once.
  const layoutIdentity = useRef<{ lines: LyricsEntry[] | null; snapKey: string }>({ lines: null, snapKey: "" });
  const snapKey = `${rowWidth}|${size.height}|${pixelRatioVersion}`;
  let snap = !motionEnabled;
  if (layoutIdentity.current.lines !== lines) {
    state.reset();
    scroll.stop();
    presence.current = { key: "", set: new Set() };
    motions.current.clear();
    layoutIdentity.current.lines = lines;
    snap = true;
  }
  if (layoutIdentity.current.snapKey !== snapKey) {
    layoutIdentity.current.snapKey = snapKey;
    snap = true;
  }

  // --- measuring -------------------------------------------------------------------------------
  const hasContent = !isLoading && lines.length > 0;
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const readFamily = () => setFamily(getComputedStyle(el).fontFamily || DEFAULT_FAMILY);
    readFamily();
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      setSize((prev) =>
        prev.width === el.clientWidth && prev.height === el.clientHeight ? prev : { width: el.clientWidth, height: el.clientHeight },
      );
    };
    measure();
    const observer = new ResizeObserver(() => {
      if (frame === null) frame = requestAnimationFrame(measure);
    });
    observer.observe(el);
    void document.fonts?.ready.then(readFamily);
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [hasContent]);

  // A window moved to a screen with another pixel density redraws its canvases sharp.
  useEffect(() => {
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onChange = () => setPixelRatioVersion((v) => v + 1);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [pixelRatioVersion]);

  // --- the sync tick -----------------------------------------------------------------------
  const tick = useCallback(() => {
    if (lines.length === 0) return;
    const position = clock.read(performance.now(), live.current.isPlaying) + live.current.syncOffsetMs;
    state.advance(lines, position, hasWordTimings);
    const key = presenceAt(items, lines, state, position);
    if (state.version !== seenVersion.current || key !== presence.current.key) {
      presence.current = { key, set: presenceSet(key) };
      rerender();
    }
    if (!live.current.isPlaying) for (const [, surface] of surfaceList.current) surface.invalidate();
    loop.wake();
  }, [lines, items, hasWordTimings, clock, state, rerender, loop]);

  // Every 80 ms while the song plays and the lyrics are on screen. Paused, it waits for a seek
  // or an offset change.
  useEffect(() => {
    if (!running || lines.length === 0) return;
    state.startTracking(clock.read(performance.now(), isPlaying) + syncOffsetMs);
    tick();
    if (isPlaying) {
      const id = window.setInterval(tick, SYNC_TICK_MS);
      return () => window.clearInterval(id);
    }
    return useMusicPlayerStore.subscribe((s, prev) => {
      if (s.progress !== prev.progress) tick();
    });
  }, [running, isPlaying, lines, syncOffsetMs, tick, clock, state]);

  useEffect(() => {
    loop.setEnabled(running);
    return () => loop.stop();
  }, [running, loop]);

  useEffect(() => () => scroll.stop(), [scroll]);

  // --- geometry of this render ------------------------------------------------------------
  const activeListIndex = activeListIndexOf(items, state.deferredCurrentLineIndex);
  const anchorY = size.height * ANCHOR_RATIO;
  const shownNow = (listIndex: number): number => {
    const motion = motions.current.get(listIndex);
    if (items[listIndex]?.kind === "indicator") return motion ? motion.presence.value : presence.current.set.has(listIndex) ? 1 : 0;
    return presence.current.set.has(listIndex) || (motion?.presence.value ?? 0) > 0 ? 1 : 0;
  };
  const heights = rowHeights(items, layouts, shownNow);
  const offsets = lyricsRowOffsets(items, heights, activeListIndex, ROW_METRICS);
  scroll.setBounds(
    lyricsMinScrollOffset(items, heights, activeListIndex, anchorY, BOTTOM_MARGIN, ROW_METRICS),
    lyricsMaxScrollOffset(items, heights, activeListIndex, anchorY, size.height, TOP_MARGIN, ROW_METRICS),
  );
  const ctx: TargetContext = {
    items,
    offsets,
    activeListIndex,
    anchorY,
    state,
    presence: presence.current.set,
    isSynced,
    active,
  };
  const rendered = renderedRows(ctx, state.userManualOffset, size.height);
  const windowKeyOf = (manual: number) => {
    const rows = renderedRows(ctx, manual, size.height);
    return `${rows[0]}-${rows[rows.length - 1]}`;
  };
  const windowKeyRef = useRef(windowKeyOf);
  windowKeyRef.current = windowKeyOf;
  renderedKey.current = windowKeyOf(state.userManualOffset);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const layoutRef = useRef({ items, layouts });
  layoutRef.current = { items, layouts };

  const motionFor = (listIndex: number): RowMotion => {
    let motion = motions.current.get(listIndex);
    if (!motion) {
      const item = items[listIndex]!;
      motion = new RowMotion(rowTarget(ctx, listIndex), item.kind === "indicator" ? "indicator" : item.entry.isBackground ? "background" : "line");
      motions.current.set(listIndex, motion);
    }
    return motion;
  };
  const renderedMotions = new Map(rendered.map((listIndex) => [listIndex, motionFor(listIndex)]));

  // Push this render's targets to the springs, then let the frame loop carry them.
  useLayoutEffect(() => {
    seenVersion.current = state.version;
    for (const listIndex of motions.current.keys()) if (!renderedMotions.has(listIndex)) motions.current.delete(listIndex);
    motionList.current = [...motions.current.values()];
    for (const [listIndex, motion] of motions.current) {
      motion.update(rowTarget(ctx, listIndex), { autoScroll: state.isAutoScrollEnabled, snap, blur: !IS_LINUX_RUNTIME });
    }
    for (const [lineIndex, surface] of surfaceList.current) surface.setCurrent(isLineActive(ctx, lineIndex));
    loop.wake();
  });

  // Back on auto scroll, the manual offset eases home while the rows spring to the sung line.
  const autoScroll = state.isAutoScrollEnabled;
  useEffect(() => {
    if (autoScroll) {
      scroll.settleHome();
      loop.wake();
    }
  }, [autoScroll, lines, scroll, loop]);

  // --- the frame loop ------------------------------------------------------------------------
  useEffect(() => {
    const heightsBuffer: number[] = [];
    let lastSignature = "";
    let presenceWasMoving = false;
    const shownInFrame = (listIndex: number): number => {
      const motion = motions.current.get(listIndex);
      if (layoutRef.current.items[listIndex]?.kind === "indicator") return motion?.presence.value ?? 0;
      return ctxRef.current.presence.has(listIndex) || (motion?.presence.value ?? 0) > 0 ? 1 : 0;
    };
    return loop.add((dt, now) => {
      let moving = false;
      const list = motionList.current;
      let presenceMoving = false;
      for (let i = 0; i < list.length; i++) {
        const motion = list[i]!;
        if (motion.step(dt)) moving = true;
        if (!motion.presence.settled) presenceMoving = true;
      }

      // A break growing, or a background line done fading out, moves every row after it.
      if (presenceMoving || presenceWasMoving) {
        const { items: rowsNow, layouts: layoutsNow } = layoutRef.current;
        const current = rowHeights(rowsNow, layoutsNow, shownInFrame, heightsBuffer);
        const signature = current.join(",");
        if (signature !== lastSignature) {
          lastSignature = signature;
          const base = ctxRef.current;
          const moved = { ...base, offsets: lyricsRowOffsets(rowsNow, current, base.activeListIndex, ROW_METRICS) };
          if (base.state.isAutoScrollEnabled) {
            for (const [listIndex, motion] of motions.current) {
              const target = rowTarget(moved, listIndex);
              motion.offset.animateTo(target.offset, target.staggerMs);
            }
          }
          moving = true;
        }
      }
      presenceWasMoving = presenceMoving;

      if (scroll.step(dt)) moving = true;
      for (let i = 0; i < list.length; i++) list[i]!.write(state.userManualOffset);

      const { isPlaying: playing, syncOffsetMs: offset, motionEnabled: motionOn } = live.current;
      const position = clock.read(now, playing) + offset;
      const sung = surfaceList.current;
      for (let i = 0; i < sung.length; i++) if (sung[i]![1].step(dt, position, playing)) moving = true;
      if (stepDots(dots.current, layoutRef.current.items, ctxRef.current.presence, position, now, playing && motionOn)) moving = true;
      return moving;
    });
  }, [loop, scroll, state, clock]);

  // --- input -------------------------------------------------------------------------------
  const onLineClick = useCallback(
    (lineIndex: number) => {
      if (scroll.consumeDragClick() || !isSynced) return;
      const line = lines[lineIndex];
      if (!line) return;
      const seekTarget = Math.max(0, line.time);
      const duration = clock.durationMs();
      if (duration <= 0 || seekTarget < duration + SEEK_SLACK_MS) onSeekTo(seekTarget);
      state.jumpTo(lineIndex);
      rerender();
    },
    [scroll, isSynced, lines, clock, onSeekTo, state, rerender],
  );

  const resync = () => {
    scroll.stop();
    const target = mainLineAt(lines, state.currentPosition) ?? state.scrollTargetIndex;
    if (target !== -1) state.userManualOffset += offsets.get(listIndexOfLine.get(target) ?? 0) ?? 0;
    state.resync(lines);
    rerender();
  };

  // Keyboard: a hidden list of the lines takes focus; arrows move through it and Enter seeks.
  const showLine = (lineIndex: number) => {
    setFocusedLine(lineIndex);
    const listIndex = listIndexOfLine.get(lineIndex);
    if (listIndex !== undefined) scroll.scrollTo(-(offsets.get(listIndex) ?? 0));
  };
  const onListKeyDown = (e: KeyboardEvent<HTMLOListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[Math.min(buttons.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
  };

  const registerSurface = useCallback(
    (lineIndex: number, surface: KaraokeSurface | null) => {
      if (surface) {
        surface.setCurrent(isLineActive({ state, active: live.current.active }, lineIndex));
        surfaces.current.set(lineIndex, surface);
      } else surfaces.current.delete(lineIndex);
      surfaceList.current = [...surfaces.current.entries()];
      loop.wake();
    },
    [state, loop],
  );
  const registerDots = useCallback(
    (listIndex: number, elements: HTMLElement[] | null) => {
      if (elements) dots.current.set(listIndex, { dots: elements, look: { opacity: 0, scale: 1 } });
      else dots.current.delete(listIndex);
      loop.wake();
    },
    [loop],
  );

  // --- render ----------------------------------------------------------------------------------
  if (isLoading) {
    const color = `rgb(${expressiveAccent.r},${expressiveAccent.g},${expressiveAccent.b})`;
    return (
      <div className={`grid place-items-center ${className}`}>
        <Loader2 className="h-8 w-8 animate-spin" style={{ color }} />
      </div>
    );
  }
  if (lines.length === 0) {
    return (
      <div className={`grid place-items-center ${className}`}>
        <p className="text-base text-chrome-neutral-400">{getString("music_lyrics_unavailable")}</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${className}`}>
      <div
        className="absolute inset-0 touch-none select-none"
        style={{ maskImage: fadeMask, WebkitMaskImage: fadeMask }}
        onWheel={(e) => scroll.wheel(e.deltaY * (e.deltaMode === 1 ? ROW_METRICS.lineHeightPx / 3 : e.deltaMode === 2 ? size.height : 1))}
        onPointerDown={(e) => {
          if (e.button === 0) scroll.pointerDown(e.pointerId, e.clientY, e.timeStamp);
        }}
        onPointerMove={(e) => {
          if (scroll.pointerMove(e.pointerId, e.clientY, e.timeStamp) && !e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        }}
        onPointerUp={(e) => {
          scroll.pointerUp(e.pointerId, e.timeStamp);
          loop.wake();
        }}
        onPointerCancel={(e) => scroll.pointerUp(e.pointerId, e.timeStamp)}
      >
        {size.width > 0 && (
          <LyricsRowList
            rendered={rendered}
            motions={renderedMotions}
            ctx={ctx}
            layouts={layouts}
            lines={lines}
            lineWords={lineWords}
            presentation={presentation}
            geometryFor={geometryFor}
            expressiveAccent={expressiveAccent}
            rowLeft={(size.width - rowWidth) / 2}
            rowWidth={rowWidth}
            focusedLine={focusedLine}
            motionEnabled={motionEnabled}
            pixelRatioVersion={pixelRatioVersion}
            onLineClick={onLineClick}
            registerSurface={registerSurface}
            registerDots={registerDots}
          />
        )}
      </div>

      <ol className="sr-only" aria-label={getString("music_lyrics")} onKeyDown={onListKeyDown}>
        {lines.map((line, lineIndex) =>
          line.text.trim() ? (
            <li key={lineIndex}>
              <button
                type="button"
                tabIndex={lineIndex === (focusedLine ?? state.deferredCurrentLineIndex) ? 0 : -1}
                onFocus={() => showLine(lineIndex)}
                onBlur={() => setFocusedLine((f) => (f === lineIndex ? null : f))}
                onClick={() => onLineClick(lineIndex)}
              >
                {line.text}
              </button>
            </li>
          ) : null,
        )}
      </ol>

      {isSynced && active && isPlaying && state.isAutoScrollEnabled && (
        <CurrentLineAnnouncer text={lines[state.deferredCurrentLineIndex]?.text ?? ""} />
      )}
      <LyricsResyncButton visible={!state.isAutoScrollEnabled && isSynced} accent={expressiveAccent} onClick={resync} />
      <LyricsProviderLabel providerName={providerName} accent={expressiveAccent} />
    </div>
  );
}
