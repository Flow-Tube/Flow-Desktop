import { useCallback, useEffect, useRef, useState } from "react";
import { getLiveChat } from "./api/youtube";
import { isSeek, mergeReplay, needsMore, replayedBy } from "./chatReplay";
import type { ChatView, ChatViewTokens, LiveChatState } from "./useLiveChat";
import { usePlayerStore } from "../store/usePlayerStore";
import type { LiveChatMessage } from "../types/video";

const RETRY_MS = 3000;

/**
 * Replays a finished stream's chat in step with the player: messages appear when playback
 * reaches the moment they were sent. Pages are fetched ahead of the playhead, and a seek starts
 * over from YouTube's seek token at the new position.
 */
export function useChatReplay(videoId: string | undefined, enabled: boolean, view: ChatView = "top"): LiveChatState {
  // Half-second steps are fine enough for chat and keep this hook from re-rendering per frame.
  const nowMs = usePlayerStore((s) => Math.floor(s.currentTime * 2) * 500);
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [ended, setEnded] = useState(false);
  const [canSwitchView, setCanSwitchView] = useState(false);
  const [reconnectNonce, setReconnectNonce] = useState(0);

  const nowRef = useRef(nowMs);
  const bufferRef = useRef<LiveChatMessage[]>([]);
  const continuationRef = useRef<string | null>(null);
  const seekRef = useRef<string | null>(null);
  const viewTokensRef = useRef<ChatViewTokens>({ top: null, all: null });
  const lastMsRef = useRef<number | null>(null);
  // Bumped on every restart; an answer for an older generation is dropped.
  const generationRef = useRef(0);
  const fetchingRef = useRef<number | null>(null);
  const retryAtRef = useRef(0);
  nowRef.current = nowMs;

  const reconnect = useCallback(() => setReconnectNonce((value) => value + 1), []);

  // Most ticks show the same messages as the last one; keep the same array then.
  const showUpTo = useCallback((ms: number) => {
    const next = replayedBy(bufferRef.current, ms);
    setMessages((previous) =>
      previous.length === next.length && previous[previous.length - 1]?.id === next[next.length - 1]?.id
        ? previous
        : next,
    );
  }, []);

  const fetchFrom = useCallback(
    (token: string | null, offsetMs: number) => {
      if (!videoId) return;
      const generation = generationRef.current;
      fetchingRef.current = generation;
      getLiveChat(videoId, token, offsetMs)
        .then((page) => {
          if (generation !== generationRef.current) return;
          bufferRef.current = mergeReplay(bufferRef.current, page.messages, nowRef.current);
          continuationRef.current = page.continuation ?? null;
          seekRef.current = page.seekContinuation ?? seekRef.current;
          if (page.topChatContinuation || page.allChatContinuation) {
            viewTokensRef.current = {
              top: page.topChatContinuation ?? viewTokensRef.current.top,
              all: page.allChatContinuation ?? viewTokensRef.current.all,
            };
            setCanSwitchView(Boolean(viewTokensRef.current.all));
          }
          setEnded(!page.continuation && bufferRef.current.length === 0);
          showUpTo(nowRef.current);
        })
        .catch((error) => {
          if (generation !== generationRef.current) return;
          console.warn("Chat replay request failed", error);
          retryAtRef.current = Date.now() + RETRY_MS;
        })
        .finally(() => {
          if (generation === generationRef.current) {
            fetchingRef.current = null;
            setLoading(false);
          }
        });
    },
    [videoId, showUpTo],
  );

  // A new video or view starts empty; a seek keeps what was already fetched, so the messages
  // before the new position stay on screen, and only the chain is replaced.
  const restart = useCallback(
    (token: string | null, keepBuffer: boolean) => {
      generationRef.current += 1;
      continuationRef.current = null;
      if (!keepBuffer) {
        bufferRef.current = [];
        setMessages([]);
        setLoading(true);
      }
      fetchFrom(token, nowRef.current);
    },
    [fetchFrom],
  );

  useEffect(() => {
    seekRef.current = null;
    viewTokensRef.current = { top: null, all: null };
    setCanSwitchView(false);
  }, [videoId]);

  useEffect(() => {
    setEnded(false);
    if (!videoId || !enabled) {
      generationRef.current += 1;
      setLoading(false);
      return;
    }
    lastMsRef.current = nowRef.current;
    restart(view === "all" ? viewTokensRef.current.all : null, false);
  }, [videoId, enabled, view, reconnectNonce, restart]);

  useEffect(() => {
    if (!videoId || !enabled) return;
    const previous = lastMsRef.current;
    lastMsRef.current = nowMs;
    if (isSeek(previous, nowMs)) {
      // The seek token resumes the same view at the new position.
      restart(seekRef.current ?? (view === "all" ? viewTokensRef.current.all : null), true);
      showUpTo(nowMs);
      return;
    }
    showUpTo(nowMs);
    const continuation = continuationRef.current;
    if (
      continuation &&
      fetchingRef.current !== generationRef.current &&
      Date.now() >= retryAtRef.current &&
      needsMore(bufferRef.current, nowMs)
    ) {
      fetchFrom(continuation, nowMs);
    }
  }, [nowMs, videoId, enabled, view, restart, fetchFrom, showUpTo]);

  return { messages, loading, ended, canSwitchView, reconnect };
}
