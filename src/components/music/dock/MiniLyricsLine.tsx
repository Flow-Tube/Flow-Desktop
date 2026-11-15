import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { LyricsClock } from "../../../lib/lyrics/display/clock";
import { buildKaraokeGeometry } from "../../../lib/lyrics/display/karaoke";
import { KaraokeSurface, karaokePadding } from "../../../lib/lyrics/display/karaokeSurface";
import { sanitizeWordTimestamps, splitTrailingHyphenWord } from "../../../lib/lyrics/display/model";
import { layoutText } from "../../../lib/lyrics/display/textLayout";
import { synthesizeWordTimings, wordCharRanges } from "../../../lib/lyrics/display/timing";
import { nextLineTimes, sungLineIndexAt } from "../../../lib/lyrics/sungLine";
import type { LyricsEntry } from "../../../lib/lyrics/types";
import { useLyricsAnimation, useLyricsGlow, type LyricsAnimation, type LyricsGlow } from "../../../lib/lyrics/useLyricsLook";
import type { Rgb } from "../../../lib/useDominantColor";
import { useLyricsStore } from "../../../store/useLyricsStore";
import { useMusicPlayerStore } from "../../../store/useMusicPlayerStore";
import type { SongItem } from "../../../types/music";
import { lyricsMeasurer } from "../lyrics/useLyricsGeometry";

const TEXT_SIZE = 13;
const TEXT_WEIGHT = 500;
const ROW_HEIGHT = 18;
const UNSUNG_ALPHA = 0.45;
const NO_LINES: LyricsEntry[] = [];

/** A CSS colour as RGB, through a one-pixel canvas so any colour syntax the theme uses works. */
function rgbOf(color: string): Rgb {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { r: 255, g: 255, b: 255 };
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 255, g = 255, b = 255] = ctx.getImageData(0, 0, 1, 1).data;
  return { r, g, b };
}

interface LineLook {
  family: string;
  accent: Rgb;
  animation: LyricsAnimation;
  glow: LyricsGlow;
  motion: boolean;
}

/** One sung line on its own karaoke canvas, the lyrics panel's drawing at the mini player's size. */
function KaraokeLine({
  line,
  nextTime,
  look,
  register,
}: {
  line: LyricsEntry;
  nextTime: number | null;
  look: LineLook;
  register: (surface: KaraokeSurface, on: boolean) => void;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [overflows, setOverflows] = useState(false);
  const pad = karaokePadding(TEXT_SIZE, look.glow);

  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const text = line.text.trim();
    const words =
      line.words && line.words.length > 0
        ? splitTrailingHyphenWord(sanitizeWordTimestamps(line.words))
        : synthesizeWordTimings(text, line.time, nextTime);
    const measurer = lyricsMeasurer();
    const style = { size: TEXT_SIZE, weight: TEXT_WEIGHT, italic: false, family: look.family, lineSpacing: 1 };
    // One row however long: the mini player cuts the end off rather than wrapping.
    const block = layoutText(text, style, Number.MAX_SAFE_INTEGER, measurer);
    const width = Math.ceil(block.rows[0]?.width ?? 0);
    const geometry = buildKaraokeGeometry(text, block, width, "left", words, wordCharRanges(text, words, false), measurer, look.animation === "cadence");
    const surface = new KaraokeSurface(canvas, {
      geometry,
      width,
      height: block.height,
      textSize: TEXT_SIZE,
      accent: look.accent,
      unsungAlpha: UNSUNG_ALPHA,
      align: "left",
      animation: look.animation,
      glow: look.glow,
      motion: look.motion,
    });
    surface.setCurrent(true);
    setOverflows(width > (canvas.parentElement?.clientWidth ?? Infinity));
    register(surface, true);
    return () => {
      surface.setCurrent(false);
      register(surface, false);
    };
  }, [line, nextTime, look, register]);

  return (
    <div
      className="absolute inset-0"
      style={overflows ? { maskImage: "linear-gradient(to right, black 85%, transparent)", WebkitMaskImage: "linear-gradient(to right, black 85%, transparent)" } : undefined}
    >
      <canvas ref={ref} aria-hidden className="pointer-events-none absolute" style={{ left: -pad.x, top: -pad.y + (ROW_HEIGHT - TEXT_SIZE * 1.2) / 2 }} />
    </div>
  );
}

/**
 * The line being sung in place of the artist, drawn by the lyrics panel's karaoke canvas with the
 * chosen animation and glow, as Android's mini player does. Lines fade into each other in a row one
 * line tall, so the title never moves; between lines and for unsynced lyrics it shows the artist.
 */
export function MiniLyricsLine({ track, artist }: { track: SongItem; artist: string }) {
  const lyricsFor = useLyricsStore((s) => s.videoId);
  const entries = useLyricsStore((s) => s.entries);
  const isSynced = useLyricsStore((s) => s.isSynced);
  const playing = useMusicPlayerStore((s) => s.isPlaying);
  const progress = useMusicPlayerStore((s) => s.progress);
  const [animation] = useLyricsAnimation();
  const [glow] = useLyricsGlow();
  const reduced = useReducedMotion();
  const ours = lyricsFor === (track.videoId ?? track.id) && isSynced;
  const lines = ours ? entries : NO_LINES;
  const nextTimes = useMemo(() => nextLineTimes(lines), [lines]);
  const [index, setIndex] = useState<number | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [look, setLook] = useState<LineLook | null>(null);
  const surface = useRef<KaraokeSurface | null>(null);
  const clock = useRef(new LyricsClock()).current;
  // A line fading out lets go only of its own surface, never the one now being sung.
  const register = useCallback((next: KaraokeSurface, on: boolean) => {
    if (on) surface.current = next;
    else if (surface.current === next) surface.current = null;
  }, []);

  // The text's own colour and font, read where the line is drawn, so every background and theme fits.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const computed = getComputedStyle(host);
    setLook({ family: computed.fontFamily, accent: rgbOf(computed.color), animation, glow, motion: !reduced });
  }, [animation, glow, reduced]);

  // One frame loop picks the line and draws it; it sleeps while paused and nothing moves.
  useEffect(() => {
    if (lines.length === 0) {
      setIndex(null);
      return;
    }
    let raf: number | null = null;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = now - last;
      last = now;
      const position = clock.read(now, playing) + useLyricsStore.getState().syncOffsetMs;
      setIndex(sungLineIndexAt(lines, position));
      const moving = surface.current?.step(dt, position, playing) ?? false;
      raf = playing || moving ? requestAnimationFrame(frame) : null;
    };
    raf = requestAnimationFrame(frame);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
    };
    // A seek while paused moves `progress`, which redraws the still frame.
  }, [lines, playing, progress, clock]);

  const line = index !== null ? lines[index] : undefined;
  return (
    <div ref={hostRef} className="relative mt-0.5 text-[13px] font-medium text-chrome-neutral-100" style={{ height: ROW_HEIGHT, overflowX: "clip" }}>
      <AnimatePresence initial={false}>
        <motion.div
          key={line && look ? `line-${index}` : "artist"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="absolute inset-0"
        >
          {line && look ? (
            <KaraokeLine
              line={line}
              nextTime={nextTimes[index!] ?? null}
              look={look}
              register={register}
            />
          ) : (
            <div dir="auto" className="line-clamp-1 text-chrome-neutral-400">
              {artist}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
