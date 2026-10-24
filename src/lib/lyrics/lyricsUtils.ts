import type { LyricsEntry, WordTimestamp } from "./types";

// LRC + rich-sync grammar.
const TIME_REGEX = /\[(\d{1,2}):(\d{2})[.:](\d{2,3})\]/g;
const RICH_SYNC_LINE_RE = /^\[(\d{1,2}):(\d{2})\.(\d{2,3})\](.*)$/;
const RICH_SYNC_WORD_RE = /<(\d{1,2}):(\d{2})\.(\d{2,3})>\s*([^<]+)/g;
const PAXSENIX_AGENT_LINE_RE = /^\[(\d{1,2}):(\d{2})\.(\d{2,3})\](v\d+):\s*(.*)$/;
const PAXSENIX_BG_LINE_RE = /^\[bg:\s*(.*)\]$/;
const AGENT_RE = /\{agent:([^}]+)\}/;
const BACKGROUND_RE = /^\{bg\}/;
const HTML_NUMERIC_ENTITY_RE = /&#(x?[0-9A-Fa-f]+);/g;
const TRAILING_TS_RE = /\[(\d{1,2}):(\d{2})\.(\d{2,3})\]\s*$/;

const HTML_NAMED: Record<string, string> = {
  "&amp;": "&",
  "&apos;": "'",
  "&#39;": "'",
  "&quot;": '"',
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
};

export function decodeHtmlEntities(text: string): string {
  let out = text;
  for (let pass = 0; pass < 2; pass++) {
    for (const [k, v] of Object.entries(HTML_NAMED)) out = out.split(k).join(v);
    out = out.replace(HTML_NUMERIC_ENTITY_RE, (_m, raw: string) => {
      const cp = raw.startsWith("x") ? parseInt(raw.slice(1), 16) : parseInt(raw, 10);
      if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return _m;
      try {
        return String.fromCodePoint(cp);
      } catch {
        return _m;
      }
    });
  }
  return out;
}

const CREDIT_PREFIXES = [
  "synced by",
  "lyrics by",
  "music by",
  "arranged by",
  "written by",
  "composed by",
];

export function filterCreditLines(entries: LyricsEntry[]): LyricsEntry[] {
  return entries.filter((e) => {
    const t = e.text.trim().toLowerCase();
    return !CREDIT_PREFIXES.some((p) => t.startsWith(p));
  });
}

export function findCurrentLineIndex(lines: LyricsEntry[], position: number): number {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.time >= position + 300) return i - 1;
  }
  return lines.length - 1;
}

export function normalizeEntries(entries: LyricsEntry[]): LyricsEntry[] {
  return entries.map((e) => ({
    ...e,
    text: decodeHtmlEntities(e.text),
    words: e.words ? e.words.map((w) => ({ ...w, text: decodeHtmlEntities(w.text) })) : e.words,
  }));
}

export function stripWordTimings(entries: LyricsEntry[]): LyricsEntry[] {
  return entries.map((e) => ({ ...e, words: null }));
}

// (min, sec, frac) capture groups → ms (2-digit frac = centiseconds).
function tsToMs(min?: string, sec?: string, frac?: string): number {
  const m = Number(min) || 0;
  const s = Number(sec) || 0;
  const fStr = frac ?? "";
  const f = Number(fStr) || 0;
  const ms = fStr.length === 3 ? f : f * 10;
  return m * 60000 + s * 1000 + ms;
}

// <word1:startSec:endSec|word2:...> — times are seconds as Double.
function parseMetrolistWordTimestamps(wordData: string): WordTimestamp[] {
  const words: WordTimestamp[] = [];
  for (const token of wordData.split("|")) {
    const parts = token.split(":");
    if (parts.length < 3) continue;
    const end = parseFloat(parts[parts.length - 1] ?? "");
    const start = parseFloat(parts[parts.length - 2] ?? "");
    const text = parts.slice(0, parts.length - 2).join(":");
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    words.push({ text, startTime: Math.round(start * 1000), endTime: Math.round(end * 1000) });
  }
  return words;
}

const isWordDataLine = (line: string): boolean => line.startsWith("<") && line.endsWith(">");

function parseStandardLyrics(lines: string[]): LyricsEntry[] {
  const out: LyricsEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (isWordDataLine(line)) continue;
    const matches = [...line.matchAll(TIME_REGEX)];
    if (matches.length === 0) continue;
    const content = line.replace(TIME_REGEX, "").trim();

    let words: WordTimestamp[] | undefined;
    const next = lines[i + 1];
    if (next && isWordDataLine(next)) {
      words = parseMetrolistWordTimestamps(next.slice(1, -1));
    }

    for (const m of matches) {
      const time = tsToMs(m[1], m[2], m[3]);
      out.push({ time, text: content, words: words ?? null });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

function stripRichSyncTags(content: string): string {
  return content
    .replace(/<\d{1,2}:\d{2}\.\d{2,3}>\s*/g, " ")
    .replace(/\[\d{1,2}:\d{2}\.\d{2,3}\]\s*$/, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?%])/g, "$1")
    .trim();
}

function nextLineStartMs(index: number, lines: string[]): number | null {
  const next = lines[index + 1];
  if (!next) return null;
  const m = next.trim().match(RICH_SYNC_LINE_RE);
  return m ? tsToMs(m[1], m[2], m[3]) : null;
}

function parseRichSyncWords(content: string, index: number, lines: string[]): WordTimestamp[] | null {
  const matches = [...content.matchAll(RICH_SYNC_WORD_RE)];
  if (matches.length === 0) return null;
  const result: WordTimestamp[] = [];

  matches.forEach((m, mi) => {
    const startTime = tsToMs(m[1], m[2], m[3]);
    let nextStart: number;
    if (mi < matches.length - 1) {
      const nm = matches[mi + 1]!;
      nextStart = tsToMs(nm[1], nm[2], nm[3]);
    } else {
      const after = content.slice((m.index ?? 0) + m[0].length);
      const tail = after.match(/[<[](\d{1,2}):(\d{2})\.(\d{2,3})[>\]]\s*$/);
      nextStart = tail
        ? tsToMs(tail[1], tail[2], tail[3])
        : nextLineStartMs(index, lines) ?? startTime + 500;
    }
    const wordText = (m[4] ?? "").replace(TRAILING_TS_RE, "");
    const ws = wordText.split(/\s+/).filter((w) => w.length > 0);
    const span = nextStart - startTime;
    const n = Math.max(1, ws.length);
    ws.forEach((w, wi) => {
      result.push({
        text: w,
        startTime: startTime + Math.round((span * wi) / n),
        endTime: startTime + Math.round((span * (wi + 1)) / n),
      });
    });
  });
  return result;
}

function parseRichSyncLyrics(lines: string[]): LyricsEntry[] {
  const out: LyricsEntry[] = [];
  let lastNonBgAgent: string | null = null;

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();

    const bg = line.match(PAXSENIX_BG_LINE_RE);
    if (bg) {
      const content = bg[1] ?? "";
      const words = parseRichSyncWords(content, index, lines);
      const lineTime = words?.[0]?.startTime ?? 0;
      out.push({
        time: lineTime,
        text: stripRichSyncTags(content),
        words,
        agent: lastNonBgAgent ?? "bg",
        isBackground: true,
      });
      return;
    }

    const agentLine = line.match(PAXSENIX_AGENT_LINE_RE);
    if (agentLine) {
      const time = tsToMs(agentLine[1], agentLine[2], agentLine[3]);
      const agent = agentLine[4] ?? "";
      const content = agentLine[5] ?? "";
      const words = parseRichSyncWords(content, index, lines);
      if (agent.trim()) lastNonBgAgent = agent;
      out.push({ time, text: stripRichSyncTags(content), words, agent, isBackground: false });
      return;
    }

    const std = line.match(RICH_SYNC_LINE_RE);
    if (std) {
      const time = tsToMs(std[1], std[2], std[3]);
      let content = std[4] ?? "";
      let agent: string | null = null;
      const am = content.match(AGENT_RE);
      if (am) {
        agent = am[1] ?? null;
        content = content.replace(AGENT_RE, "");
      }
      let isBackground = false;
      if (BACKGROUND_RE.test(content)) {
        isBackground = true;
        content = content.replace(BACKGROUND_RE, "");
      }
      const words = parseRichSyncWords(content, index, lines);
      if (!isBackground && agent && agent.trim()) lastNonBgAgent = agent;
      out.push({ time, text: stripRichSyncTags(content), words, agent, isBackground });
    }
  });

  out.sort((a, b) => a.time - b.time);

  // Same-timestamp, word-less, non-bg follow-ups are translations of the prior line.
  for (let i = out.length - 1; i > 0; i--) {
    const cur = out[i]!;
    const prev = out[i - 1]!;
    if (
      cur.time === prev.time &&
      !cur.isBackground &&
      !prev.isBackground &&
      (!cur.words || cur.words.length === 0) &&
      cur.text.trim()
    ) {
      prev.translation = prev.translation ? `${prev.translation}\n${cur.text}` : cur.text;
      out.splice(i, 1);
    }
  }
  return out;
}

export function parseLyrics(lyrics: string): LyricsEntry[] {
  let normalized = lyrics.trim();
  if (normalized.startsWith('"') && normalized.endsWith('"')) normalized = normalized.slice(1, -1);
  normalized = normalized
    .replace(/\\\\/g, "\\")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t");

  const lines = normalized
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0 && !l.trim().startsWith("[offset:"));

  const isRichSync = lines.some((l) => {
    const t = l.trim();
    return (
      (RICH_SYNC_LINE_RE.test(t) && /<\d{1,2}:\d{2}\.\d{2,3}>/.test(l)) ||
      PAXSENIX_AGENT_LINE_RE.test(t) ||
      PAXSENIX_BG_LINE_RE.test(t)
    );
  });

  return isRichSync ? parseRichSyncLyrics(lines) : parseStandardLyrics(lines);
}
