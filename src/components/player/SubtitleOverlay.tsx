import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invokeBackend } from "../../lib/api/errors";
import { logToBackend } from "../../lib/diagnostics";
import { getString } from "../../lib/i18n/index";
import type { CaptionTrack } from "../../types/video";
import { usePlayerStore } from "../../store/usePlayerStore";

const FETCH_MAX_ATTEMPTS = 3;
const FETCH_RETRY_MS = 1500;
const FETCH_FAILED_NOTICE_MS = 5000;
// YouTube's 100% caption size: 16px for every 360px of height of the 16:9 frame that fits the player.
const CAPTION_SIZE = "[--caption-size:calc(min(100cqh,100cqw*9/16)/22.5)]";
// YouTube's rule for an upright video in a player over 1.3 times taller than wide (the Shorts page):
// 16px for every 480px of player width.
const UPRIGHT_TALL_CAPTION_SIZE = "[@container(aspect-ratio<10/13)]:[--caption-size:calc(100cqw/30)]";
// A floor YouTube doesn't have: its mini player shrinks captions to 5px at 50% scale.
const MIN_CAPTION_PX = 12;

/** Fractions of the player: the captions' centre from the left, their bottom from the bottom. */
type CaptionPosition = { x: number; y: number };

export type CaptionCue = {
  start: number;
  end: number;
  text: string;
  /** Which side the cue's lines line up on; centred when unset. */
  align?: "start" | "end";
  /** The words of a line YouTube reveals as they're spoken, with when each is. */
  words?: CaptionWord[];
};

export type CaptionWord = {
  start: number;
  text: string;
};

// An inline timestamp, as in "irrational<00:00:26.960> numbers", marks when the words after it are spoken.
const WORD_TIMESTAMP = /<((?:\d+:)?\d{2}:\d{2}\.\d{3})>/;
const WORD_TIMESTAMPS = new RegExp(WORD_TIMESTAMP.source, "g");

interface SubtitleOverlayProps {
  captions: CaptionTrack[];
  selectedCaptionId: string;
  currentTime: number;
  shouldShowControls: boolean;
  /** The video is at least as tall as it is wide. */
  uprightVideo?: boolean;
}

function cleanCueText(text: string): string {
  const normalized = text
    .replace(/\u00A0/g, " ")
    .replace(/[ \t\v\f\r]+/g, " ");

  return normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

export function lastCueLine(text: string): string {
  return text.slice(text.lastIndexOf("\n") + 1);
}

// Auto-generated captions roll up: each cue shows the previous line above the one being spoken, with
// a brief cue holding just the finished line in between. Folding that into the cue before keeps the
// box from dropping to one line for a moment as each new line starts.
function mergeRollUpHoldCues(cues: CaptionCue[]): CaptionCue[] {
  const merged: CaptionCue[] = [];
  for (const cue of cues) {
    const previous = merged[merged.length - 1];
    if (previous && cue.text === lastCueLine(previous.text)) {
      merged[merged.length - 1] = { ...previous, end: cue.end };
    } else {
      merged.push(cue);
    }
  }
  return merged;
}

function parseVttTimestamp(value: string) {
  const parts = value.trim().split(":");
  const secondsPart = parts.pop() || "0";
  const seconds = Number(secondsPart.replace(",", "."));
  const minutes = Number(parts.pop() || 0);
  const hours = Number(parts.pop() || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

// Line by line, as tags never span lines: a stray "<" can't then reach the next cue's timing line.
// Word timestamps stay, as the only tags that start with a digit.
function stripVttTags(vtt: string): string {
  return vtt
    .split("\n")
    .map((line) => line.replace(/<(?!\d)[^>]*>/g, ""))
    .join("\n");
}

// Splits the line YouTube times word by word into its words and when each is spoken. Words before
// the first timestamp start with the cue.
function cueWords(text: string, cueStart: number): CaptionWord[] | undefined {
  const timedLine = text.split("\n").find((line) => WORD_TIMESTAMP.test(line));
  if (!timedLine) return undefined;
  const parts = timedLine.split(WORD_TIMESTAMP);
  const words: CaptionWord[] = [{ start: cueStart, text: parts[0] ?? "" }];
  for (let index = 1; index < parts.length; index += 2) {
    words.push({ start: parseVttTimestamp(parts[index] ?? ""), text: parts[index + 1] ?? "" });
  }
  return words.map((word) => ({ ...word, text: word.text.replace(/ /g, " ").replace(/[ \t\v\f\r]+/g, " ") }));
}

// Browsers have no API that only decodes entities. A textarea is the standard way: the parser
// decodes entities in its content but never reads it as tags.
function decodeHtmlEntities(text: string): string {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = text;
  return textarea.value;
}

function parseVttCues(vtt: string): CaptionCue[] {
  // Tags first, so an escaped "&lt;i&gt;" stays as text.
  return decodeHtmlEntities(stripVttTags(vtt))
    .replace(/\r/g, "")
    .split("\n\n")
    .flatMap((block) => {
      const lines = block.split("\n").filter(Boolean);
      const timingIndex = lines.findIndex((line) => line.includes("-->"));
      if (timingIndex < 0) return [];

      const timingLine = lines[timingIndex];
      if (!timingLine) return [];
      const [startRaw, endRaw] = timingLine.split("-->");
      if (!startRaw || !endRaw) return [];

      const [end, ...settings] = endRaw.trim().split(/\s+/);
      if (!end) return [];
      const text = lines
        .slice(timingIndex + 1)
        .join("\n")
        .trim();

      if (!text) return [];
      const cleanedText = cleanCueText(text.replace(WORD_TIMESTAMPS, ""));
      if (!cleanedText) return [];

      const start = parseVttTimestamp(startRaw);
      return [
        {
          start,
          end: parseVttTimestamp(end),
          text: cleanedText,
          align: cueAlign(settings),
          words: cueWords(text, start),
        },
      ];
    });
}

// YouTube's auto-generated cues set align:start, so their rolling lines share a left edge.
function cueAlign(settings: string[]): CaptionCue["align"] {
  const align = settings.find((setting) => setting.startsWith("align:"))?.slice("align:".length);
  if (align === "start" || align === "left") return "start";
  if (align === "end" || align === "right") return "end";
  return undefined;
}

function parseTimedTextCues(text: string): CaptionCue[] {
  const doc = new DOMParser().parseFromString(text, "text/xml");
  return Array.from(doc.querySelectorAll("text")).flatMap((node) => {
    const start = Number(node.getAttribute("start"));
    const duration = Number(node.getAttribute("dur") || 0);
    const content = (node.textContent || "").trim();
    if (!Number.isFinite(start) || !content) return [];
    
    const cleanedText = cleanCueText(content);
    if (!cleanedText) return [];

    return [{ start, end: start + duration, text: cleanedText }];
  });
}

function parseJsonCues(jsonText: string): CaptionCue[] {
  try {
    const data = JSON.parse(jsonText);
    if (data && Array.isArray(data.events)) {
      return data.events.flatMap((event: any) => {
        const start = (event.tStartMs || 0) / 1000;
        const duration = (event.dDurationMs || 0) / 1000;
        const text = (event.segs || [])
          .map((seg: any) => seg.utf8 || "")
          .join("")
          .trim();
        if (!text) return [];

        const cleanedText = cleanCueText(text);
        if (!cleanedText) return [];

        return [{ start, end: start + duration, text: cleanedText }];
      });
    }
  } catch (error) {
    void logToBackend("warn", "subtitle JSON parse failed", { cause: String(error) });
  }
  return [];
}

export function parseCaptionCues(text: string, isAutoGenerated: boolean): CaptionCue[] {
  const trimmed = text.trim();
  let cues: CaptionCue[];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    cues = parseJsonCues(trimmed);
  } else if (trimmed.startsWith("WEBVTT") || trimmed.includes("-->")) {
    cues = parseVttCues(trimmed);
  } else {
    cues = parseTimedTextCues(trimmed);
  }
  return isAutoGenerated ? mergeRollUpHoldCues(cues) : cues;
}

// Optimized binary search active cue finder - O(log N)
function findActiveCue(cues: CaptionCue[], time: number): CaptionCue | null {
  if (cues.length === 0) return null;

  let low = 0;
  let high = cues.length - 1;
  let bestIdx = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const midCue = cues[mid];
    if (midCue !== undefined && midCue.start <= time) {
      bestIdx = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (bestIdx !== -1) {
    const cue = cues[bestIdx];
    if (cue !== undefined) {
      if (time >= cue.start && time <= cue.end) {
        return cue;
      }
      for (let i = bestIdx - 1; i >= 0; i--) {
        const c = cues[i];
        if (c === undefined) continue;
        if (time - c.start >= 5) break;
        if (time >= c.start && time <= c.end) {
          return c;
        }
      }
    }
  }
  return null;
}

export const SubtitleOverlay: React.FC<SubtitleOverlayProps> = ({
  captions,
  selectedCaptionId,
  currentTime,
  shouldShowControls,
  uprightVideo = false,
}) => {
  const [captionCues, setCaptionCues] = useState<CaptionCue[]>([]);
  const [trackFailed, setTrackFailed] = useState(false);
  
  const subtitleStyle = usePlayerStore((s) => s.subtitleStyle);
  const containerRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const linesRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<((pointer: React.PointerEvent) => CaptionPosition) | null>(null);
  const [dragPosition, setDragPosition] = useState<CaptionPosition | null>(null);
  const [placedPosition, setPlacedPosition] = useState<CaptionPosition | null>(null);
  const lastCueRef = useRef<CaptionCue | null>(null);

  // As on YouTube, captions dragged somewhere stay there only for the video they were dragged on;
  // each video starts at the saved height. Changing that height drops them back onto it at once.
  useEffect(() => setPlacedPosition(null), [captions, subtitleStyle.bottomOffset]);
  const [rollingOut, setRollingOut] = useState<string | null>(null);

  useEffect(() => {
    const caption = captions.find((item) => item.id === selectedCaptionId);
    if (!caption) {
      setCaptionCues([]);
      setTrackFailed(false);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const load = () => {
      invokeBackend<string>("fetch_subtitles", { url: caption.url })
        .then((text) => {
          if (cancelled) return;
          setCaptionCues(parseCaptionCues(text, !!caption.isAutoGenerated));
          setTrackFailed(false);
        })
        .catch((error) => {
          if (cancelled) return;
          attempt += 1;
          setCaptionCues([]);
          void logToBackend("warn", "subtitle track fetch failed", {
            label: caption.label,
            languageCode: caption.languageCode,
            autoGenerated: !!caption.isAutoGenerated,
            attempt,
            cause: String(error),
          });
          // Auto-translated tracks are the ones YouTube rate-limits, and it
          // clears within seconds — so a couple of retries recovers a track that
          // would otherwise stay silently blank for the whole video.
          if (attempt >= FETCH_MAX_ATTEMPTS) {
            setTrackFailed(true);
            return;
          }
          timer = setTimeout(load, FETCH_RETRY_MS * attempt);
        });
    };

    load();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [captions, selectedCaptionId]);

  useEffect(() => {
    if (!trackFailed) return;
    const timer = setTimeout(() => setTrackFailed(false), FETCH_FAILED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [trackFailed]);

  const activeCue =
    selectedCaptionId === "off"
      ? null
      : findActiveCue(captionCues, currentTime);

  // Auto-generated captions roll up as on YouTube: the two line slots stay put while the text scrolls
  // through them, the top line leaving as the next comes in underneath. While it scrolls, the line
  // leaving is drawn above the cue's own two, in a box clipped to two lines.
  useLayoutEffect(() => {
    const previousLines = lastCueRef.current?.text.split("\n") ?? [];
    const lines = activeCue?.text.split("\n") ?? [];
    lastCueRef.current = activeCue;
    const rolled = previousLines.length > 1 && lines.length > 1 && lines[0] === previousLines[previousLines.length - 1];
    const animate = rolled && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setRollingOut(animate ? (previousLines[0] ?? null) : null);
  }, [activeCue]);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const lines = linesRef.current;
    const leaving = lines?.firstElementChild;
    if (!rollingOut || !anchor || !lines || !leaving) return;
    const step = leaving.getBoundingClientRect().height;
    anchor.style.height = `${lines.getBoundingClientRect().height - step}px`;
    anchor.style.overflow = "hidden";
    // Held at the end until the re-render without the leaving line, so it never flashes back.
    const roll = lines.animate([{ transform: "none" }, { transform: `translateY(-${step}px)` }], {
      duration: 250,
      easing: "ease-out",
      fill: "forwards",
    });
    roll.onfinish = () => setRollingOut(null);
    return () => {
      roll.cancel();
      anchor.style.height = "";
      anchor.style.overflow = "";
    };
  }, [rollingOut]);

  // YouTube gives left-aligned (rolling) captions a window as wide as the track's longest line, so the
  // text stays put as line lengths change. Sized in em, it follows the caption size.
  const startAligned = activeCue?.align === "start";
  const hasCue = activeCue !== null;
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    anchor.style.minWidth = "";
    const context = startAligned ? document.createElement("canvas").getContext("2d") : null;
    if (!context) return;
    const font = getComputedStyle(anchor);
    context.font = `${font.fontWeight} 100px ${font.fontFamily}`;
    const lines = captionCues.flatMap((cue) => cue.text.split("\n"));
    const longest = Math.max(0, ...lines.map((line) => context.measureText(line).width));
    // 0.8em is a line's padding on both sides.
    anchor.style.minWidth = `min(${longest / 100 + 0.8}em, calc(100cqw - 4rem))`;
  }, [captionCues, startAligned, hasCue, subtitleStyle.isBold]);

  // A cue wider or taller than the one the captions were placed with, or a smaller player, would
  // push them past an edge, so each render nudges them back inside. It runs after the effects above
  // so it measures the box as drawn: clipped to two lines while rolling, at its minimum width.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const area = containerRef.current?.getBoundingClientRect();
    if (!anchor || !area) return;
    anchor.style.translate = "";
    const caption = anchor.getBoundingClientRect();
    const dx = Math.max(0, area.left - caption.left) + Math.min(0, area.right - caption.right);
    const dy = Math.max(0, area.top - caption.top) + Math.min(0, area.bottom - caption.bottom);
    if (dx || dy) anchor.style.translate = `${dx}px ${dy}px`;
  });

  if (!activeCue && !trackFailed) return null;

  const hexColor = (subtitleStyle.backgroundColor || "#000000").replace("#", "");
  const r = parseInt(hexColor.substring(0, 2), 16) || 0;
  const g = parseInt(hexColor.substring(2, 4), 16) || 0;
  const b = parseInt(hexColor.substring(4, 6), 16) || 0;
  const bgRgba = `rgba(${r}, ${g}, ${b}, ${subtitleStyle.backgroundOpacity})`;

  const textStyle: React.CSSProperties = {
    fontSize: `max(${MIN_CAPTION_PX}px, var(--caption-size) * ${subtitleStyle.fontScale / 100})`,
    color: subtitleStyle.textColor,
    fontWeight: subtitleStyle.isBold ? "700" : "500",
  };

  const cueLines = (activeCue ? activeCue.text : getString("subtitles_track_unavailable")).split("\n");
  const timedLine = cueLines[cueLines.length - 1] ?? "";
  const spoken = activeCue?.words
    ?.filter((word) => word.start <= currentTime)
    .map((word) => word.text)
    .join("")
    .trim();
  // Words not spoken yet keep their space, unseen, so the line doesn't shift as they come in.
  const unspoken = spoken !== undefined && timedLine.startsWith(spoken) ? timedLine.slice(spoken.length) : "";
  if (unspoken) cueLines[cueLines.length - 1] = spoken ?? "";
  const shownLines = rollingOut === null ? cueLines : [rollingOut, ...cueLines];

  // Only the block's outer corners are rounded, so stacked lines meet without a notch between them.
  const lineStyle = (index: number): React.CSSProperties => {
    const top = index === 0 ? "0.2em" : "0";
    const bottom = index === shownLines.length - 1 ? "0.2em" : "0";
    return { backgroundColor: bgRgba, padding: "0.1em 0.4em", borderRadius: `${top} ${top} ${bottom} ${bottom}` };
  };
  const lineAlign = activeCue?.align === "start" ? "flex-start" : activeCue?.align === "end" ? "flex-end" : "center";

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const area = containerRef.current?.getBoundingClientRect();
    if (!area || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const caption = event.currentTarget.getBoundingClientRect();
    // Keep the point that was grabbed under the pointer, and the whole caption inside the player.
    const grabX = event.clientX - (caption.left + caption.width / 2);
    const grabY = caption.bottom - event.clientY;
    const halfWidth = caption.width / 2 / area.width;
    const height = caption.height / area.height;
    const toPosition = (pointer: React.PointerEvent) => ({
      x: Math.min(1 - halfWidth, Math.max(halfWidth, (pointer.clientX - grabX - area.left) / area.width)),
      y: Math.min(1 - height, Math.max(0, (area.bottom - pointer.clientY - grabY) / area.height)),
    });
    dragRef.current = toPosition;
    setDragPosition(toPosition(event));
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) setDragPosition(dragRef.current(event));
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    setPlacedPosition(dragRef.current(event));
    dragRef.current = null;
    setDragPosition(null);
  };

  const defaultY = subtitleStyle.bottomOffset / 100;
  const position = dragPosition ?? placedPosition ?? { x: 0.5, y: defaultY };
  // Near the bottom, the captions lift clear of the controls while they show; dragged higher, they stay put.
  const bottom =
    shouldShowControls && !dragPosition
      ? `max(${position.y * 100}cqh, calc(${defaultY * 100}cqh + 64px))`
      : `${position.y * 100}cqh`;

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 z-30 [container-type:size]">
      <div
        ref={anchorRef}
        className={`pointer-events-auto absolute w-max max-w-[calc(100cqw-4rem)] cursor-move touch-none select-none ${CAPTION_SIZE} ${uprightVideo ? UPRIGHT_TALL_CAPTION_SIZE : ""} ${dragPosition ? "" : "transition-[bottom] duration-150"}`}
        style={{
          left: `${position.x * 100}%`,
          bottom,
          transform: "translateX(-50%)",
          textAlign: activeCue?.align ?? "center",
          lineHeight: "1.35",
          ...textStyle,
        }}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* A box per line, as on YouTube: one inline box wrapping across lines overlaps itself and
            only pads its first and last line's outer ends. */}
        {/* Flex items stack flush, where inline boxes leave a sub-pixel gap between lines. */}
        <div ref={linesRef} className="flex flex-col" style={{ alignItems: lineAlign }}>
          {shownLines.map((line, index) => (
            <div key={index} className="flex">
              {line && <span style={lineStyle(index)}>{line}</span>}
              {index === shownLines.length - 1 && unspoken && (
                <span className="invisible whitespace-pre">{unspoken}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SubtitleOverlay;
