import { useCallback, useEffect, useRef } from "react";

import type { ViewFormat } from "../api/recap";
import { onBeforeProfileSwitch } from "../profiles/beforeSwitch";
import type { WatchSubject } from "../useWatchSession";
import { isKnownShort } from "../videoKind";
import { MUSIC_COUNT_FRACTION } from "./musicSession";
import { flushRecapQueue, recapListen, recapView } from "./recapQueue";
import { RecapViewSession, WATCHED_FRACTION, type ViewStretch } from "./viewSession";

export interface RecapSubject extends WatchSubject {
  durationSeconds?: number | null;
  thumbnailUrl?: string | null;
  channelAvatarUrl?: string | null;
}

function formatOf(subject: RecapSubject): ViewFormat {
  if (subject.isLive) return "LIVE";
  return isKnownShort(subject.durationSeconds) ? "SHORT" : "LONG";
}

function send(subject: RecapSubject, stretch: ViewStretch) {
  if (subject.isMusic) {
    // Music opened in the video player is listening, and never enters the video ledger.
    recapListen({
      trackId: subject.videoId,
      title: subject.title,
      artistName: subject.channelName.replace(/ - Topic$/, ""),
      artworkUrl: subject.thumbnailUrl ?? "",
      listenedMs: stretch.watchedMs,
      counted: stretch.counted,
      skipped: stretch.skipped,
      continued: stretch.continued,
    });
    return;
  }
  recapView({
    videoId: subject.videoId,
    title: subject.title,
    channelId: subject.channelId,
    channelName: subject.channelName,
    channelAvatarUrl: subject.channelAvatarUrl ?? "",
    description: subject.description,
    format: formatOf(subject),
    watchedMs: stretch.watchedMs,
    counted: stretch.counted,
    skipped: stretch.skipped,
    continued: stretch.continued,
  });
}

/** Feeds the recap ledger from the video player's time updates; the work per tick is arithmetic. */
export function useRecapViewSession(subject: RecapSubject | null) {
  const subjectRef = useRef(subject);
  const sessionRef = useRef<RecapViewSession | null>(null);
  const videoId = subject?.videoId ?? null;
  const isMusic = subject?.isMusic ?? false;

  useEffect(() => {
    if (subject?.videoId === videoId) subjectRef.current = subject;
  }, [subject, videoId]);

  useEffect(() => {
    if (!videoId) return;
    const session = new RecapViewSession(
      () => (subjectRef.current ? formatOf(subjectRef.current) : "LONG"),
      (stretch) => {
        if (subjectRef.current) send(subjectRef.current, stretch);
      },
      isMusic ? MUSIC_COUNT_FRACTION : WATCHED_FRACTION,
    );
    sessionRef.current = session;
    const save = () => {
      session.close();
      return flushRecapQueue();
    };
    window.addEventListener("beforeunload", save);
    const offSwitch = onBeforeProfileSwitch(save);
    return () => {
      window.removeEventListener("beforeunload", save);
      offSwitch();
      session.close();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [videoId, isMusic]);

  return useCallback((positionSeconds: number, durationSeconds: number) => {
    sessionRef.current?.tick(positionSeconds * 1000, durationSeconds * 1000, Date.now());
  }, []);
}
