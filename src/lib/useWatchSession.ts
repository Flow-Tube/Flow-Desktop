import { useCallback, useEffect, useRef } from "react";
import { endWatchSession, reportWatchProgress, type WatchReport } from "./api/recommendation";

const REPORT_INTERVAL_MS = 5000;
/** A larger jump between two time updates is a seek, not playback. */
const MAX_PLAYED_STEP_SECONDS = 3;

export interface WatchSubject {
  videoId: string;
  title: string;
  channelName: string;
  channelId: string;
  description: string | null;
  isLive: boolean;
  /** Music played in the video player never teaches the video engine. */
  isMusic: boolean;
  category: string | null;
}

interface Progress {
  videoId: string;
  position: number;
  duration: number;
  unreportedPlayed: number;
  reportedAt: number;
}

/** Folds one time update into the progress of `videoId`, starting over for a new video. */
export function advanceProgress(
  previous: Progress | null,
  videoId: string,
  position: number,
  duration: number,
): Progress {
  if (!previous || previous.videoId !== videoId) {
    return { videoId, position, duration, unreportedPlayed: 0, reportedAt: 0 };
  }
  const step = position - previous.position;
  const played = step > 0 && step < MAX_PLAYED_STEP_SECONDS ? step : 0;
  return {
    ...previous,
    position,
    duration: duration > 0 ? duration : previous.duration,
    unreportedPlayed: previous.unreportedPlayed + played,
  };
}

/**
 * Reports one viewing of a video to the recommendation engine. The backend keeps the session,
 * so details arriving late, a remount or a hand-off to the pop-out window never end it; this
 * hook only says how far playback got and when the player let go of the video.
 */
export function useWatchSession(subject: WatchSubject | null) {
  const subjectRef = useRef(subject);
  const progressRef = useRef<Progress | null>(null);

  useEffect(() => {
    subjectRef.current = subject;
  }, [subject]);

  const takeReport = useCallback((videoId: string): WatchReport | null => {
    const current = subjectRef.current;
    const progress = progressRef.current;
    if (!current || current.videoId !== videoId || !progress || progress.videoId !== videoId) {
      return null;
    }
    if (current.isMusic) return null;
    const report: WatchReport = {
      ...current,
      position: progress.position,
      duration: progress.duration,
      playedDelta: progress.unreportedPlayed,
    };
    progressRef.current = { ...progress, unreportedPlayed: 0, reportedAt: Date.now() };
    return report;
  }, []);

  const onTime = useCallback(
    (position: number, duration: number) => {
      const current = subjectRef.current;
      if (!current) return;
      const progress = advanceProgress(progressRef.current, current.videoId, position, duration);
      progressRef.current = progress;
      if (Date.now() - progress.reportedAt < REPORT_INTERVAL_MS) return;
      const report = takeReport(current.videoId);
      if (report) {
        void reportWatchProgress(report).catch((err) => console.warn("Failed to report watch progress", err));
      }
    },
    [takeReport],
  );

  const end = useCallback(
    (videoId: string, natural: boolean) => {
      const report = takeReport(videoId);
      if (!report) return;
      if (natural && report.duration > 0) report.position = report.duration;
      void endWatchSession(report, natural).catch((err) => console.warn("Failed to end watch session", err));
    },
    [takeReport],
  );

  const videoId = subject?.videoId ?? null;
  useEffect(() => {
    if (!videoId) return;
    const onUnload = () => end(videoId, false);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      end(videoId, false);
    };
  }, [videoId, end]);

  const onEnded = useCallback(() => {
    if (videoId) end(videoId, true);
  }, [videoId, end]);

  return { onTime, onEnded };
}
