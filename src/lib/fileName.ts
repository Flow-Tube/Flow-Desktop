const UNSAFE_FILE_NAME_CHARS = /[\\/:*?"<>|\p{Cc}]/gu;
const MAX_FILE_NAME_LENGTH = 80;

/** A file name every file system accepts. Letters of every script are kept; `fallback` stands in for an empty name. */
export function safeFileName(name: string, fallback: string): string {
  return name.replace(UNSAFE_FILE_NAME_CHARS, "_").trim().slice(0, MAX_FILE_NAME_LENGTH).trim() || fallback;
}
