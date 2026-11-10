// The format of changelog/*.txt, read by the release script and by the app's Changelog dialog,
// so this module must stay free of Node imports.
const TITLE_LINES = new Set(["FLOW DESKTOP CHANGE LOG", "FLOW CHANGE LOG"]);
const META_LINE = /^(VERSION|DATE|STATUS):(.*)$/i;
const HEADING_LINE = /^[A-Z][A-Z &/,:-]+:?$/;

export function parseChangelog(text) {
  const meta = {};
  const blocks = [];
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (blocks.length > 0 && blocks.at(-1).kind !== "blank") blocks.push({ kind: "blank" });
      continue;
    }
    if (TITLE_LINES.has(line)) continue;

    const metaMatch = META_LINE.exec(line);
    if (metaMatch && metaMatch[2].trim()) {
      meta[metaMatch[1].toUpperCase()] = metaMatch[2].trim();
      continue;
    }

    if (HEADING_LINE.test(line)) {
      if (blocks.length > 0 && blocks.at(-1).kind !== "blank") blocks.push({ kind: "blank" });
      blocks.push({ kind: "heading", text: line.replace(/:+$/, "") });
      continue;
    }

    blocks.push({ kind: "text", text: raw.trimEnd() });
  }

  while (blocks.at(-1)?.kind === "blank") blocks.pop();
  return { meta, blocks };
}
