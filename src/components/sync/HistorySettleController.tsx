import { useHistorySettles } from "../../lib/linked/historySettles";

/** Headless: sends watch history to linked devices when the video player settles. */
export function HistorySettleController() {
  useHistorySettles();
  return null;
}
