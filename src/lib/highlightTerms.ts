/** A piece of text, and whether it is one of the searched words. */
export interface TextPiece {
  text: string;
  match: boolean;
}

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Splits `text` so each word of `query` (two letters or more) can be shown in bold. */
export function highlightTerms(text: string, query: string): TextPiece[] {
  const words = Array.from(new Set(query.toLowerCase().split(/\s+/u).filter((word) => word.length >= 2)));
  if (words.length === 0 || !text) return [{ text, match: false }];
  words.sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${words.map(escape).join('|')})`, 'giu');
  return text
    .split(pattern)
    .filter((piece) => piece !== '')
    .map((piece) => ({ text: piece, match: words.includes(piece.toLowerCase()) }));
}
