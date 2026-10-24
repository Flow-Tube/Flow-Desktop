import type { LyricsEntry, WordTimestamp } from "./types";

const METADATA_NS = "http://www.w3.org/ns/ttml#metadata";
const PARAMETER_NS = "http://www.w3.org/ns/ttml#parameter";

interface DomSpan {
  text: string;
  startTimeMs: number;
  endTimeMs: number;
  hasTrailingSpace: boolean;
}

// Clock formats: "1234ms", "1.5s", "HH:MM:SS.mmm", "MM:SS.mmm".
function parseTime(timeStr: string | null): number {
  if (!timeStr) return 0;
  const s = timeStr.trim();
  if (s.endsWith("ms")) return Math.round(parseFloat(s.slice(0, -2)) || 0);
  if (s.endsWith("s")) return Math.round((parseFloat(s.slice(0, -1)) || 0) * 1000);

  const parts = s.split(":");
  let h = 0;
  let m = 0;
  let rest = "0";
  if (parts.length === 3) {
    h = Number(parts[0]) || 0;
    m = Number(parts[1]) || 0;
    rest = parts[2] ?? "0";
  } else if (parts.length === 2) {
    m = Number(parts[0]) || 0;
    rest = parts[1] ?? "0";
  } else {
    rest = parts[0] ?? "0";
  }

  const [secStr, fracRaw = ""] = rest.split(".");
  const sec = Number(secStr) || 0;
  let frac = fracRaw;
  if (frac.length > 3) frac = frac.slice(0, 3);
  else while (frac.length < 3) frac += "0";
  const ms = frac ? Number(frac) || 0 : 0;
  return h * 3600000 + m * 60000 + sec * 1000 + ms;
}

function ttmlAttr(el: Element, local: string): string {
  return (
    el.getAttribute(`ttm:${local}`) ||
    el.getAttribute(local) ||
    el.getAttributeNS(METADATA_NS, local) ||
    ""
  );
}

function timingAttr(el: Element, local: string): string {
  return el.getAttribute(local) || el.getAttributeNS(PARAMETER_NS, local) || "";
}

const localName = (el: Element): string =>
  el.localName || el.nodeName.split(":").pop() || el.nodeName;

const childElements = (el: Element): Element[] =>
  Array.from(el.childNodes).filter((n): n is Element => n.nodeType === 1);

function nextIsWhitespaceText(node: Node): boolean {
  const next = node.nextSibling;
  return !!next && next.nodeType === 3 && /^\s/.test(next.textContent ?? "");
}

function parseWordSpan(span: Element, offsetMs: number, out: DomSpan[]): void {
  const begin = timingAttr(span, "begin");
  const end = timingAttr(span, "end");
  if (!begin || !end) return;
  const text = span.textContent ?? "";
  const hasTrailingSpace = /\s$/.test(text) || nextIsWhitespaceText(span);
  out.push({
    text,
    startTimeMs: parseTime(begin) + offsetMs,
    endTimeMs: parseTime(end) + offsetMs,
    hasTrailingSpace,
  });
}

function mergeSpansIntoWords(spans: DomSpan[]): WordTimestamp[] {
  const first = spans[0];
  if (!first) return [];
  const result: WordTimestamp[] = [];
  let text = first.text;
  let start = first.startTimeMs;
  let end = first.endTimeMs;
  let prevTrailing = first.hasTrailingSpace;
  let prevText = first.text;

  for (let i = 1; i < spans.length; i++) {
    const span = spans[i]!;
    if (prevTrailing && !prevText.trimEnd().endsWith("-")) {
      const t = text.trim();
      if (t) result.push({ text: t, startTime: start, endTime: end });
      text = span.text;
      start = span.startTimeMs;
    } else {
      text += span.text;
    }
    end = span.endTimeMs;
    prevTrailing = span.hasTrailingSpace;
    prevText = span.text;
  }
  const t = text.trim();
  if (t) result.push({ text: t, startTime: start, endTime: end });
  return result;
}

function buildLineText(words: WordTimestamp[]): string {
  let s = "";
  words.forEach((w, i) => {
    s += w.text;
    if (i < words.length - 1 && !w.text.endsWith("-")) s += " ";
  });
  return s.trim();
}

function directText(el: Element): string {
  let s = "";
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) s += node.textContent ?? "";
    else if (node.nodeType === 1) {
      const child = node as Element;
      if (localName(child) === "span") {
        const role = ttmlAttr(child, "role");
        if (role !== "x-bg" && role !== "x-translation" && role !== "x-roman") {
          s += child.textContent ?? "";
        }
      }
    }
  }
  return s.trim();
}

function findFirstSpanBegin(p: Element): string | null {
  let best: string | null = null;
  let bestMs = Number.MAX_SAFE_INTEGER;
  for (const span of p.getElementsByTagName("*")) {
    if (localName(span) !== "span") continue;
    const begin = timingAttr(span, "begin");
    if (!begin) continue;
    const ms = parseTime(begin);
    if (ms < bestMs) {
      bestMs = ms;
      best = begin;
    }
  }
  return best;
}

interface LineExtras {
  translations: string[];
  romanizations: string[];
}

const emptyExtras = (): LineExtras => ({ translations: [], romanizations: [] });

/** Files a translation or romanization span under its own field; false for any other span. */
function collectExtra(span: Element, extras: LineExtras): boolean {
  const role = ttmlAttr(span, "role");
  const list = role === "x-translation" ? extras.translations : role === "x-roman" ? extras.romanizations : null;
  if (!list) return false;
  const text = (span.textContent ?? "").trim();
  if (text) list.push(text);
  return true;
}

const joinExtras = (extras: LineExtras): Pick<LyricsEntry, "translation" | "romanization"> => ({
  translation: extras.translations.length ? extras.translations.join("\n") : null,
  romanization: extras.romanizations.length ? extras.romanizations.join("\n") : null,
});

function parseBackgroundSpan(span: Element, parentStartMs: number, offsetMs: number): LyricsEntry | null {
  const begin = timingAttr(span, "begin");
  const startMs = begin ? parseTime(begin) + offsetMs : parentStartMs;
  const wordSpans: DomSpan[] = [];
  const extras = emptyExtras();
  for (const child of childElements(span)) {
    if (localName(child) !== "span") continue;
    if (!collectExtra(child, extras)) parseWordSpan(child, offsetMs, wordSpans);
  }
  const words = mergeSpansIntoWords(wordSpans);
  const text = words.length ? buildLineText(words) : (span.textContent ?? "").trim();
  if (!text.trim()) return null;
  return {
    time: startMs,
    text,
    words: words.length ? words : null,
    agent: "bg",
    isBackground: true,
    ...joinExtras(extras),
  };
}

function parseParagraph(p: Element, result: LyricsEntry[], offsetMs: number, divAgent: string | null): void {
  const beginAttr = timingAttr(p, "begin") || findFirstSpanBegin(p);
  const startMs = parseTime(beginAttr) + offsetMs;
  const agent = ttmlAttr(p, "agent") || divAgent;
  const isBackground = ttmlAttr(p, "role") === "x-bg";

  const spans: DomSpan[] = [];
  const extras = emptyExtras();
  const backgroundLines: LyricsEntry[] = [];

  for (const child of childElements(p)) {
    if (localName(child) !== "span") continue;
    const role = ttmlAttr(child, "role");
    if (role === "x-bg") {
      if (isBackground) parseWordSpan(child, offsetMs, spans);
      else {
        const bg = parseBackgroundSpan(child, startMs, offsetMs);
        if (bg) backgroundLines.push(bg);
      }
    } else if (!collectExtra(child, extras)) {
      parseWordSpan(child, offsetMs, spans);
    }
  }

  const words = mergeSpansIntoWords(spans);
  const text = words.length ? buildLineText(words) : directText(p);
  // A paragraph holding only a background span would otherwise become an empty timed line.
  if (text.trim()) {
    result.push({
      time: startMs,
      text,
      words: words.length ? words : null,
      agent,
      isBackground,
      ...joinExtras(extras),
    });
  }
  result.push(...backgroundLines);
}

function walkDom(el: Element, result: LyricsEntry[], offsetMs: number, parentAgent: string | null): void {
  const name = localName(el);
  if (name === "div") {
    const agent = ttmlAttr(el, "agent") || parentAgent;
    for (const child of childElements(el)) walkDom(child, result, offsetMs, agent);
  } else if (name === "p") {
    parseParagraph(el, result, offsetMs, parentAgent);
  } else {
    for (const child of childElements(el)) walkDom(child, result, offsetMs, parentAgent);
  }
}

export function parseTTMLToLyricsEntries(xmlData: string): LyricsEntry[] {
  const doc = new DOMParser().parseFromString(xmlData, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return [];
  const root = doc.documentElement;
  if (!root) return [];

  let offsetMs = 0;
  const audio = doc.getElementsByTagName("audio");
  for (const a of audio) {
    const off = a.getAttribute("lyricOffset");
    if (off) {
      offsetMs = Math.round((parseFloat(off) || 0) * 1000);
      break;
    }
  }

  const result: LyricsEntry[] = [];
  const bodies = root.getElementsByTagName("*");
  let body: Element | null = null;
  for (const el of bodies) {
    if (localName(el) === "body") {
      body = el;
      break;
    }
  }
  if (body) walkDom(body, result, offsetMs, null);
  return result.sort((a, b) => a.time - b.time);
}
