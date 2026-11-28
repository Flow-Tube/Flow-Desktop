import { OLDEST_PAGE_LIMIT } from "./commentFilters";
import type { Comment } from "../types/video";

/**
 * Searching comments. YouTube has no comment search for viewers, so Flow matches the comments it
 * has loaded: every word must appear in the text or the author's name, a "quoted phrase" counts as
 * one word, and case and accents are ignored.
 */

/** Pages one press of Keep searching reads at most, about 500 comments, as Oldest does. */
export const SEARCH_PAGE_LIMIT = OLDEST_PAGE_LIMIT;
/** Keep searching stops early once it has found this many more comments. */
export const SEARCH_MATCH_TARGET = 20;

export interface FoundRange {
  start: number;
  end: number;
}

interface Folded {
  text: string;
  /** For each code unit of `text`, where its character starts in the original. */
  origin: number[];
}

/**
 * One character as searching compares it: lower case, the dotless i as an i, and without the
 * accents of Latin, Greek and Cyrillic letters. Other scripts keep their marks, so a Japanese が
 * stays apart from か.
 */
function foldChar(char: string): string {
  return char.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/ı/g, "i");
}

/** `text` folded for comparing, with the way back to each character's place in `text`. */
export function foldForSearch(text: string): Folded {
  let folded = "";
  const origin: number[] = [];
  let at = 0;
  for (const char of text) {
    const piece = foldChar(char);
    folded += piece;
    for (let unit = 0; unit < piece.length; unit++) origin.push(at);
    at += char.length;
  }
  return { text: folded, origin };
}

/** The words of a search, folded; a quoted phrase is one word. */
export function parseCommentQuery(input: string): string[] {
  const terms: string[] = [];
  for (const match of input.matchAll(/"([^"]*)"|(\S+)/g)) {
    const term = foldForSearch((match[1] ?? match[2] ?? "").trim().replace(/\s+/g, " ")).text;
    if (term && !terms.includes(term)) terms.push(term);
  }
  return terms;
}

const foldedText = new WeakMap<Comment, { text: string; author: string }>();

function foldedOf(comment: Comment): { text: string; author: string } {
  let folded = foldedText.get(comment);
  if (!folded) {
    folded = { text: foldForSearch(comment.text ?? "").text, author: foldForSearch(comment.author ?? "").text };
    foldedText.set(comment, folded);
  }
  return folded;
}

/** Whether every word of the search is in the comment's text or its author's name. */
export function commentMatches(comment: Comment, terms: readonly string[]): boolean {
  const { text, author } = foldedOf(comment);
  return terms.every((term) => text.includes(term) || author.includes(term));
}

/** Whether a comment, or one of its replies loaded so far, matches the search. */
export function threadMatches(comment: Comment, replies: Comment[] | undefined, terms: readonly string[]): boolean {
  return commentMatches(comment, terms) || Boolean(replies?.some((reply) => commentMatches(reply, terms)));
}

/** Where the search's words are in `text`, in order, with overlapping finds joined. */
export function foundRanges(text: string, terms: readonly string[]): FoundRange[] {
  if (!text || terms.length === 0) return [];
  const folded = foldForSearch(text);
  const ranges: FoundRange[] = [];
  for (const term of terms) {
    for (let from = folded.text.indexOf(term); from !== -1; from = folded.text.indexOf(term, from + term.length)) {
      const last = folded.origin[from + term.length - 1]!;
      const lastChar = String.fromCodePoint(text.codePointAt(last)!);
      ranges.push({ start: folded.origin[from]!, end: last + lastChar.length });
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  const joined: FoundRange[] = [];
  for (const range of ranges) {
    const previous = joined[joined.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else joined.push({ ...range });
  }
  return joined;
}
