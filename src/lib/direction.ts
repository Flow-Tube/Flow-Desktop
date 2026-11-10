// Right-to-left support the browser can't give on its own: popup positions computed in script,
// motion offsets, and text whose direction differs from the interface's. The interface direction
// is set once at start (changing the language reloads the window), so reading it on each call is
// enough.

type HorizontalEdges = { left: number; right: number };

const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const STRONG_CHAR = /[\p{L}]/u;

/** The direction of the first strong character, as the Unicode bidi algorithm picks a paragraph's. */
export function isRtlText(text: string): boolean {
  for (const char of text) {
    if (STRONG_CHAR.test(char)) return RTL_CHAR.test(char);
  }
  return false;
}

/** Whether the interface reads right to left (Arabic, Persian, Urdu). */
export function isRtl(): boolean {
  return typeof document !== "undefined" && document.documentElement.dir === "rtl";
}

/** +1 when the inline end is to the right, -1 when it is to the left: multiplies an x offset. */
export function inlineSign(): 1 | -1 {
  return isRtl() ? -1 : 1;
}

/** Lines a popup's end edge up with the button's, so it opens back across the page. */
export function alignToEnd(rect: HorizontalEdges): { left: number } | { right: number } {
  return isRtl() ? { left: rect.left } : { right: rect.right };
}

/** Lines a popup's start edge up with the button's. */
export function alignToStart(rect: HorizontalEdges): { left: number } | { right: number } {
  return isRtl() ? { right: rect.right } : { left: rect.left };
}

/** Opens a popup at a point, such as a right-click, growing toward the inline end. */
export function growFromPoint(x: number): { left: number } | { right: number } {
  return isRtl() ? { right: x } : { left: x };
}

const FIRST_STRONG_ISOLATE = "\u2068";
const POP_DIRECTIONAL_ISOLATE = "\u2069";

/**
 * Joins pieces such as a channel name, "1.2M views" and "3 days ago" into one line. Each piece
 * keeps its own direction, so an English piece in an Arabic line, or the reverse, can't pull the
 * separators and numbers around it out of place.
 */
export function joinIsolated(parts: ReadonlyArray<string | null | undefined | false>, separator = " • "): string {
  return parts
    .filter((part): part is string => Boolean(part))
    .map((part) => FIRST_STRONG_ISOLATE + part + POP_DIRECTIONAL_ISOLATE)
    .join(separator);
}

/** The interface's direction, for a menu that must read right to left again inside a left-to-right player. */
export function interfaceDir(): "rtl" | "ltr" {
  return isRtl() ? "rtl" : "ltr";
}
