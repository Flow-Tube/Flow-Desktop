import { invoke } from "@tauri-apps/api/core";

interface LyricsHttpResponse {
  status: number;
  body: string;
}

export async function lyricsHttpGet(
  url: string,
  headers?: Record<string, string>,
): Promise<LyricsHttpResponse> {
  return invoke<LyricsHttpResponse>("lyrics_http_get", { url, headers });
}

export async function lyricsGetText(
  url: string,
  headers?: Record<string, string>,
): Promise<string> {
  const res = await lyricsHttpGet(url, headers);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.body;
}

export async function lyricsGetJson<T>(
  url: string,
  headers?: Record<string, string>,
): Promise<T> {
  return JSON.parse(await lyricsGetText(url, headers)) as T;
}

/** The answer, or null when the service says it has nothing here. Any other refusal is a failure. */
export async function lyricsGetJsonOrMiss<T>(
  url: string,
  headers?: Record<string, string>,
): Promise<T | null> {
  const res = await lyricsHttpGet(url, headers);
  if (res.status === 404) return null;
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(res.body) as T;
}

export const enc = (s: string): string => encodeURIComponent(s);
