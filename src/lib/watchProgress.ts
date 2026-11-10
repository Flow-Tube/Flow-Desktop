import { addWatchRecord, getWatchHistory } from "./api/db";
import { profileStorage } from "./storage/profileStorage";
import { HISTORY_UPDATED_EVENT } from "../store/useHistoryStore";

const PROGRESS_PREFIX = "flow_watch_progress:";
const HISTORY_LOOKBACK = 2000;

/** Forgets how far a video was watched: no resume point, and history no longer counts it as watched. */
export async function clearWatchProgress(videoId: string): Promise<void> {
  profileStorage.removeItem(`${PROGRESS_PREFIX}${videoId}`);
  const history = await getWatchHistory(HISTORY_LOOKBACK, 0);
  const record = history.find((item) => item.videoId === videoId);
  if (record) await addWatchRecord({ ...record, watchDurationSeconds: 0 });
  window.dispatchEvent(new Event(HISTORY_UPDATED_EVENT));
}
