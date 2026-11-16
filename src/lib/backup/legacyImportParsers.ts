import { getString } from "../i18n/index";
import type { WatchHistoryRecord } from "../../types/db";

export interface ParsedChannel { id: string; name: string; }

const extractChannelIdFromUrl = (url: string): string => {
  if (!url) return "";
  let id = "";
  if (url.includes("/channel/")) { id = url.split("/channel/")[1] || ""; }
  else if (url.includes("/@")) { id = url.split("/@")[1] || ""; }
  else if (url.includes("/user/")) { id = url.split("/user/")[1] || ""; }
  else { id = url; }
  return (id.split("/")[0] || "").split("?")[0]?.trim() || "";
};

/** Channels from a JSON subscription export (NewPipe, LibreTube, old Flow files). */
export function parseJsonSubscriptions(data: any): ParsedChannel[] {
  const channels: ParsedChannel[] = [];
  let rawSubs: any[] = [];
  if (Array.isArray(data)) { rawSubs = data; }
  else if (data?.subscriptions && Array.isArray(data.subscriptions)) { rawSubs = data.subscriptions; }

  for (const item of rawSubs) {
    if (!item || typeof item !== "object") continue;
    if (item.channelId && (item.channelName || item.name)) {
      channels.push({ id: item.channelId.trim(), name: (item.channelName || item.name).trim() });
    } else if (item.url && item.name) {
      const id = extractChannelIdFromUrl(item.url);
      if (id) channels.push({ id, name: item.name.trim() });
    }
  }

  if (channels.length === 0 && data && typeof data === "object") {
    const visited = new Set<any>();
    const search = (obj: any) => {
      if (!obj || typeof obj !== "object" || visited.has(obj)) return;
      visited.add(obj);
      if (Array.isArray(obj)) { for (const val of obj) search(val); return; }
      const cId = obj.channelId || obj.id;
      const cName = obj.channelName || obj.name || obj.title;
      if (typeof cId === "string" && cId.startsWith("UC") && cId.length >= 20 && typeof cName === "string" && cName.length > 0) {
        channels.push({ id: cId.trim(), name: cName.trim() });
      } else { for (const key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) search(obj[key]); } }
    };
    search(data);
  }

  const seen = new Set<string>();
  return channels.filter(ch => { if (seen.has(ch.id)) return false; seen.add(ch.id); return true; });
}

/** Watch history from a Takeout `watch-history.json`. */
export function parseJsonWatchHistory(data: any): WatchHistoryRecord[] {
  if (!Array.isArray(data)) return [];
  return data.filter((item: any) => item.titleUrl).map((item: any) => {
    let videoId = "";
    try { videoId = item.titleUrl.includes("v=") ? item.titleUrl.split("v=")[1]?.split("&")[0] : item.titleUrl.split("/").pop(); } catch { return null; }
    if (!videoId || videoId.length < 10) return null;
    return { videoId, title: item.title ? item.title.replace("Watched ", "").trim() : "Watched Video", channelName: item.subtitles?.[0]?.name || "YouTube Creator", watchDate: item.time || new Date().toISOString(), watchDurationSeconds: 0, totalDurationSeconds: 0 };
  }).filter(Boolean) as WatchHistoryRecord[];
}

/** Watch history from FreeTube's NDJSON export. */
export function parseFreeTubeWatchHistory(text: string): WatchHistoryRecord[] {
  return text.split("\n").filter(l => l.trim()).map(line => {
    try { const item = JSON.parse(line); if (!item.videoId) return null; return { videoId: item.videoId, title: item.title || "FreeTube Video", channelName: item.author || getString('settings_creator'), watchDate: item.timeWatched ? new Date(item.timeWatched).toISOString() : new Date().toISOString(), watchDurationSeconds: item.watchProgress ? Math.round((item.lengthSeconds || 0) * item.watchProgress) : 0, totalDurationSeconds: item.lengthSeconds || 0 }; } catch { return null; }
  }).filter(Boolean) as WatchHistoryRecord[];
}

/** Watch history from a Takeout `watch-history.html`. */
export function parseHtmlWatchHistory(html: string): WatchHistoryRecord[] {
  const records: WatchHistoryRecord[] = [];
  const videoRegex = /href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{10,12})"[^>]*?>([^<]+)<\/a>/gi;
  const channelRegex = /href="https:\/\/www\.youtube\.com\/channel\/([^"&\s>]+)"[^>]*?>([^<]+)<\/a>/gi;
  const videoMatches: { index: number; id: string; title: string }[] = [];
  const channelMatches: { index: number; name: string }[] = [];
  let m;
  while ((m = videoRegex.exec(html)) !== null) { if (m[1] && m[2]) videoMatches.push({ index: m.index, id: m[1], title: m[2] }); }
  while ((m = channelRegex.exec(html)) !== null) { if (m[2]) channelMatches.push({ index: m.index, name: m[2] }); }
  let ci = 0;
  videoMatches.forEach((vid, i) => {
    while (ci < channelMatches.length && (channelMatches[ci]?.index ?? 0) < vid.index) ci++;
    const ch = channelMatches[ci];
    records.push({ videoId: vid.id, title: vid.title, channelName: ch && (ch.index - vid.index < 1200) ? ch.name : "YouTube Creator", watchDate: new Date(Date.now() - i * 60000).toISOString(), watchDurationSeconds: 0, totalDurationSeconds: 0 });
  });
  return records;
}
