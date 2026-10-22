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

/** "Top chat", YouTube's filtered default, or every message. */
export type ChatView = "top" | "all";

export interface ChatViewTokens {
  top: string | null;
  all: string | null;
}

export interface LiveChatState {
  messages: LiveChatMessage[];
  loading: boolean;
  // Chat is unavailable for this video, or its stream has closed.
  ended: boolean;
  /** The chat offered both views, so `view` can switch between them. */
  canSwitchView: boolean;
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
export function useLiveChat(videoId: string | undefined, enabled: boolean, view: ChatView = "top"): LiveChatState {
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [ended, setEnded] = useState(false);
  const [canSwitchView, setCanSwitchView] = useState(false);
  const [reconnectNonce, setReconnectNonce] = useState(0);

  const seenRef = useRef<Set<string>>(new Set());
  const backlogKeyRef = useRef<string | null>(null);
  const viewTokensRef = useRef<ChatViewTokens>({ top: null, all: null });
  const tokensVideoRef = useRef<string | undefined>(undefined);

  const reconnect = useCallback(() => setReconnectNonce((value) => value + 1), []);

  useEffect(() => {
    // A reconnect resumes the same conversation, so only a different video or view clears the
    // backlog: the two views are different streams of messages.
    const backlogKey = videoId ? `${videoId}:${view}` : null;
    if (tokensVideoRef.current !== videoId) {
      tokensVideoRef.current = videoId;
      viewTokensRef.current = { top: null, all: null };
      setCanSwitchView(false);
    }
    if (backlogKeyRef.current !== backlogKey) {
      backlogKeyRef.current = backlogKey;
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
    // The seed is Top chat; the all-messages view restarts from the token the first page offered.
    const restartToken = () => (view === "all" ? viewTokensRef.current.all : null);
    let continuation: string | null = restartToken();
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
        if (page.topChatContinuation || page.allChatContinuation) {
          viewTokensRef.current = {
            top: page.topChatContinuation ?? viewTokensRef.current.top,
            all: page.allChatContinuation ?? viewTokensRef.current.all,
          };
          setCanSwitchView(Boolean(viewTokensRef.current.all));
        }

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
          continuation = restartToken();
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
  }, [videoId, enabled, view, reconnectNonce]);

  return { messages, loading, ended, canSwitchView, reconnect };
}
