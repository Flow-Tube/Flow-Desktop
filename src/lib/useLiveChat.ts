import { useCallback, useEffect, useRef, useState } from "react";
import { getLiveChat } from "./api/youtube";
import type { LiveChatMessage } from "../types/video";

const MAX_MESSAGES = 200;
const MAX_SEEN_IDS = 1500;
const RETRY_MS = 3000;
const MAX_RETRY_MS = 30000;
const MAX_FAILURES = 6;
const MAX_RESEEDS = 3;
const MIN_POLL_MS = 800;

export interface LiveChatState {
  messages: LiveChatMessage[];
  loading: boolean;
  // Chat is unavailable for this video, or its stream has closed.
  ended: boolean;
  reconnect: () => void;
}

/**
 * Polls YouTube's native live chat for `videoId` while `enabled`. Seeds the continuation token
 * on the first call, then walks the continuation chain at the server-recommended cadence,
 * de-duplicating by message id and capping the in-memory backlog.
 *
 * A chain that runs out of continuations is re-seeded rather than treated as the end of chat:
 * YouTube drops the chain on its own often enough that giving up on the first gap leaves a live
 * stream with a dead panel. Only a chain that will not re-seed is reported as ended.
 */
export function useLiveChat(videoId: string | undefined, enabled: boolean): LiveChatState {
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [ended, setEnded] = useState(false);
  const [reconnectNonce, setReconnectNonce] = useState(0);

  const seenRef = useRef<Set<string>>(new Set());
  const backlogKeyRef = useRef<string | null>(null);

  const reconnect = useCallback(() => setReconnectNonce((value) => value + 1), []);

  useEffect(() => {
    // A reconnect resumes the same conversation, so only a different video clears the backlog.
    if (backlogKeyRef.current !== videoId) {
      backlogKeyRef.current = videoId ?? null;
      seenRef.current = new Set();
      setMessages([]);
    }
    setEnded(false);

    if (!videoId || !enabled) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let continuation: string | null = null;
    let failures = 0;
    let reseeds = 0;
    setLoading(true);

    const schedule = (delay: number) => {
      if (cancelled) return;
      timer = setTimeout(() => void poll(), delay);
    };

    const poll = async () => {
      if (cancelled) return;
      try {
        const page = await getLiveChat(videoId, continuation);
        if (cancelled) return;
        setLoading(false);

        const fresh = page.messages.filter((m) => !seenRef.current.has(m.id));
        if (fresh.length > 0) {
          for (const m of fresh) seenRef.current.add(m.id);
          if (seenRef.current.size > MAX_SEEN_IDS) {
            seenRef.current = new Set(Array.from(seenRef.current).slice(-MAX_SEEN_IDS));
          }
          setMessages((prev) => {
            const next = [...prev, ...fresh];
            return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
          });
        }

        if (!page.continuation) {
          if (reseeds >= MAX_RESEEDS) {
            setEnded(true);
            return;
          }
          reseeds += 1;
          continuation = null;
          schedule(RETRY_MS);
          return;
        }

        failures = 0;
        reseeds = 0;
        continuation = page.continuation;
        schedule(Math.max(MIN_POLL_MS, page.pollingIntervalMs || 2000));
      } catch (err) {
        if (cancelled) return;
        failures += 1;
        console.warn("Live chat poll failed", err);
        if (failures >= MAX_FAILURES) {
          setLoading(false);
          setEnded(true);
          return;
        }
        // Backing off matters more than reconnecting fast: YouTube throttles a
        // chat that keeps hammering it, and a fixed retry never lets that clear.
        schedule(Math.min(MAX_RETRY_MS, RETRY_MS * 2 ** (failures - 1)));
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [videoId, enabled, reconnectNonce]);

  return { messages, loading, ended, reconnect };
}
