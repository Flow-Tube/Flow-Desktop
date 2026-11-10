import { getSetting, setSetting } from "./api/db";
import { getVideoDetails } from "./api/youtube";
import type { ShortItem } from "../types/shorts";
import type { ShortVideoSummary } from "../types/video";

const SAVED_SHORTS_SETTING_KEY = "saved_shorts_library";
const TITLE_REPAIR_LIMIT = 24;

export const SAVED_SHORTS_LIBRARY_UPDATED_EVENT = "flow:saved-shorts-library-updated";

export function shortItemToSummary(short: ShortItem): ShortVideoSummary {
  return {
    type: "short",
    id: short.id,
    title: short.title || "Short",
    channelName: short.channelName || null,
    channelId: short.channelId ?? null,
    thumbnailUrl: short.thumbnailUrl ?? `https://i.ytimg.com/vi/${short.id}/oar2.jpg`,
    channelAvatarUrl: short.channelAvatarUrl ?? null,
    viewCountText: short.viewCountText ?? null,
    publishedText: short.publishedText ?? null,
  };
}

function normalizeShort(short: ShortVideoSummary): ShortVideoSummary | null {
  if (!short.id) return null;
  return {
    type: "short",
    id: short.id,
    title: short.title || "Short",
    channelName: short.channelName ?? null,
    channelId: short.channelId ?? null,
    thumbnailUrl: short.thumbnailUrl ?? `https://i.ytimg.com/vi/${short.id}/oar2.jpg`,
    channelAvatarUrl: short.channelAvatarUrl ?? null,
    viewCountText: short.viewCountText ?? null,
    publishedText: short.publishedText ?? null,
    addedAtInPlaylist: short.addedAtInPlaylist ?? null,
    durationSeconds: short.durationSeconds ?? null,
  };
}

function needsTitleRepair(short: ShortVideoSummary) {
  const title = short.title.trim().toLowerCase();
  return !title || title === "short";
}

function notifySavedShortsUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SAVED_SHORTS_LIBRARY_UPDATED_EVENT));
  }
}

async function repairSavedShortTitles(shorts: ShortVideoSummary[]) {
  const repairTargets = shorts.filter(needsTitleRepair).slice(0, TITLE_REPAIR_LIMIT);
  if (repairTargets.length === 0) return shorts;

  const repairedById = new Map<string, ShortVideoSummary>();
  await Promise.all(
    repairTargets.map(async (short) => {
      try {
        const details = await getVideoDetails(short.id);
        const title = details.title?.trim();
        if (!title) return;
        repairedById.set(short.id, {
          ...short,
          title,
          channelName: details.channelName || short.channelName,
          channelId: details.channelId ?? short.channelId ?? null,
          thumbnailUrl: details.thumbnailUrl ?? short.thumbnailUrl,
          viewCountText: details.viewCountText ?? short.viewCountText ?? null,
          publishedText: details.publishedText ?? short.publishedText ?? null,
        });
      } catch (error) {
        console.warn("Failed to repair saved Short title", short.id, error);
      }
    }),
  );

  if (repairedById.size === 0) return shorts;
  const repaired = shorts.map((short) => repairedById.get(short.id) ?? short);
  await persistSavedShorts(repaired);
  return repaired;
}

export async function loadSavedShorts(
  options: { repairTitles?: boolean } = {},
): Promise<ShortVideoSummary[]> {
  const raw = await getSetting(SAVED_SHORTS_SETTING_KEY);
  if (!raw) return [];

  const parsed = JSON.parse(raw) as ShortVideoSummary[];
  const seen = new Set<string>();
  const normalized = parsed
    .map(normalizeShort)
    .filter((short): short is ShortVideoSummary => {
      if (!short || seen.has(short.id)) return false;
      seen.add(short.id);
      return true;
    });

  return options.repairTitles === false ? normalized : repairSavedShortTitles(normalized);
}

async function persistSavedShorts(shorts: ShortVideoSummary[]) {
  await setSetting(SAVED_SHORTS_SETTING_KEY, JSON.stringify(shorts));
  notifySavedShortsUpdated();
}

export async function isShortSaved(shortId: string) {
  const shorts = await loadSavedShorts({ repairTitles: false });
  return shorts.some((short) => short.id === shortId);
}

export async function saveShortToLibrary(short: ShortVideoSummary | ShortItem) {
  const summary = "type" in short ? normalizeShort(short) : shortItemToSummary(short);
  if (!summary) return loadSavedShorts({ repairTitles: false });

  const shorts = await loadSavedShorts({ repairTitles: false });
  const next = [
    { ...summary, addedAtInPlaylist: Date.now() },
    ...shorts.filter((savedShort) => savedShort.id !== summary.id),
  ];
  await persistSavedShorts(next);
  return next;
}

export async function removeShortFromLibrary(shortId: string) {
  const shorts = await loadSavedShorts({ repairTitles: false });
  const next = shorts.filter((short) => short.id !== shortId);
  await persistSavedShorts(next);
  return next;
}
