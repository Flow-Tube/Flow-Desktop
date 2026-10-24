import { invokeBackend } from "./errors";

/** The saved queue's JSON, or null when nothing is saved. */
export function loadMusicQueueState(): Promise<string | null> {
  return invokeBackend<string | null>("load_music_queue_state");
}

export function saveMusicQueueState(state: string): Promise<void> {
  return invokeBackend<void>("save_music_queue_state", { state });
}

export function clearMusicQueueState(): Promise<void> {
  return invokeBackend<void>("clear_music_queue_state");
}

/** Where a long track was left, in seconds, or null when it never was. */
export function getMusicResumePosition(videoId: string): Promise<number | null> {
  return invokeBackend<number | null>("get_music_resume_position", { videoId });
}

export function saveMusicResumePosition(
  videoId: string,
  positionSeconds: number,
  durationSeconds: number,
): Promise<void> {
  return invokeBackend<void>("save_music_resume_position", { videoId, positionSeconds, durationSeconds });
}
