import { profileStorage } from "./storage/profileStorage";
const CONTINUE_WATCHING_HIDDEN_KEY = "flow_continue_watching_hidden_v1";

const readHiddenIds = (): string[] => {
  try {
    const raw = profileStorage.getItem(CONTINUE_WATCHING_HIDDEN_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch (error) {
    console.warn("Failed to read hidden Continue Watching videos", error);
    return [];
  }
};

export const getHiddenContinueWatchingIds = (): Set<string> => new Set(readHiddenIds());

export const hideContinueWatchingVideo = (videoId: string) => {
  try {
    const hidden = getHiddenContinueWatchingIds();
    hidden.add(videoId);
    profileStorage.setItem(CONTINUE_WATCHING_HIDDEN_KEY, JSON.stringify(Array.from(hidden)));
  } catch (error) {
    console.warn("Failed to hide Continue Watching video", error);
  }
};
