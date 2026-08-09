/**
 * Drift policy for the second media element that carries audio when the chosen
 * video variant is video-only (adaptive playback in the Watch player and in
 * Shorts).
 *
 * Writing `currentTime` on a media element restarts its fetch and decode. A
 * correction issued while the element is still recovering from the previous one
 * cancels that work, so a naive "if drifted, realign" loop running every few
 * hundred milliseconds can keep an element permanently starved — which is what
 * silenced audio after a seek, after pause/resume and after a quality switch,
 * and what made a stalling video replay the same second of audio forever.
 *
 * Two rules follow from that, and both are load-bearing:
 *
 * 1. Never realign more often than the element can act on. A correction is only
 *    allowed once per {@link AUDIO_RESYNC_MIN_INTERVAL_MS} window and only when
 *    the element is not already seeking and has data.
 * 2. Never rewind audio that has run ahead of a video whose own clock has
 *    stopped advancing. Rewinding restarts the audio and leaves the video just
 *    as stuck, so the next tick rewinds it again. Hold the audio instead and let
 *    the video close the gap; playback resumes on its own once it does. Audio
 *    ahead of a *healthy* video is ordinary drift and is realigned normally.
 *
 * A video that has run out of decodable data ({@link ExternalAudioSyncInput.videoStarved})
 * is treated as not-advancing even if its clock moved recently: a clock sampler
 * lags a stall by a few hundred milliseconds, which is exactly the window in
 * which a quality switch lets the audio sprint ahead of the rebuffering video.
 */

export const AUDIO_DRIFT_TOLERANCE_SECONDS = 0.5;
export const AUDIO_RESYNC_MIN_INTERVAL_MS = 1200;
export const AUDIO_HOLD_RELEASE_DRIFT_SECONDS = 0.12;

/** `HTMLMediaElement.HAVE_CURRENT_DATA` — the element can accept a seek. */
const HAVE_CURRENT_DATA = 2;

export type ExternalAudioAction =
  /** In tolerance — leave the clock alone (rate trimming may still apply). */
  | "steady"
  /** Pause the audio and wait for the starved video to catch up. */
  | "hold"
  /** Held audio has been caught up to; unpause it. */
  | "resume"
  /** Move the audio clock onto the video's. */
  | "realign"
  /** Out of tolerance, but acting now would make it worse. */
  | "wait";

export interface ExternalAudioSyncInput {
  /** `audio.currentTime - video.currentTime`; positive means audio is ahead. */
  drift: number;
  /** Whether the audio is currently paused because the video fell behind. */
  held: boolean;
  /** Whether the video's own clock is still moving forward. */
  videoAdvancing: boolean;
  /**
   * The video element lacks the data to keep playing (readyState below
   * HAVE_FUTURE_DATA), e.g. right after a direct-mode quality switch swapped
   * its src while the audio element kept its buffer.
   */
  videoStarved?: boolean;
  audioSeeking: boolean;
  audioReadyState: number;
  msSinceLastRealign: number;
}

export function decideExternalAudioSync({
  drift,
  held,
  videoAdvancing,
  videoStarved = false,
  audioSeeking,
  audioReadyState,
  msSinceLastRealign,
}: ExternalAudioSyncInput): ExternalAudioAction {
  if (held) {
    if (videoStarved) return "wait";
    return drift <= AUDIO_HOLD_RELEASE_DRIFT_SECONDS ? "resume" : "wait";
  }
  if (Math.abs(drift) <= AUDIO_DRIFT_TOLERANCE_SECONDS) return "steady";
  if (drift > 0 && (!videoAdvancing || videoStarved)) return "hold";
  if (msSinceLastRealign < AUDIO_RESYNC_MIN_INTERVAL_MS) return "wait";
  if (audioSeeking || audioReadyState < HAVE_CURRENT_DATA) return "wait";
  return "realign";
}
