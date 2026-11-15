/**
 * Channel handle normalization, step for step the same as the AiSList pipeline, Flow for Android
 * and the backend (`src-tauri/src/ai_list/handle.rs`), or nothing matches.
 */

const MAX_LENGTH = 64;
// JavaScript's \s, which the pipeline trims and rejects with, and the characters a handle never has.
const FORBIDDEN = /[\s/%?#@]/u;

function extract(text: string): string {
  let rest: string;
  if (text.startsWith("@")) {
    rest = text.slice(1);
  } else {
    const at = text.indexOf("/@");
    if (at < 0) return text;
    rest = text.slice(at + 2);
  }
  const end = rest.search(/[/?#]/);
  return end < 0 ? rest : rest.slice(0, end);
}

function percentDecode(text: string): string {
  if (!text.includes("%")) return text;
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** The handle without `@`, lowercased, or null when the input is not a usable handle. */
export function normalizeAiHandle(input: string | null | undefined): string | null {
  if (!input) return null;
  const handle = percentDecode(extract(input.trim())).normalize("NFC").toLowerCase();
  if (handle.length === 0 || [...handle].length > MAX_LENGTH) return null;
  if (FORBIDDEN.test(handle)) return null;
  return handle;
}
