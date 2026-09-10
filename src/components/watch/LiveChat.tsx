import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loader2, Radio, ShieldCheck, BadgeCheck, ArrowDown, RotateCw } from "lucide-react";
import { useLiveChat } from "../../lib/useLiveChat";
import { getString } from "../../lib/i18n/index";
import type { LiveChatMessage, LiveChatSegment } from "../../types/video";
import type { LiveChatProps } from "./types";

function argbToCss(argb?: number | null): string | undefined {
  if (argb == null) return undefined;
  const r = (argb >>> 16) & 0xff;
  const g = (argb >>> 8) & 0xff;
  const b = argb & 0xff;
  const a = ((argb >>> 24) & 0xff) / 255;
  return `rgba(${r}, ${g}, ${b}, ${a || 1})`;
}

// Rec. 709 luma decides black vs white foreground over a colored super-chat background.
function prefersDarkText(argb?: number | null): boolean {
  if (argb == null) return false;
  const r = (argb >>> 16) & 0xff;
  const g = (argb >>> 8) & 0xff;
  const b = argb & 0xff;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6;
}

function MessageBody({ segments, message }: { segments: LiveChatSegment[]; message: string }) {
  if (!segments?.length) return <>{message}</>;
  return (
    <>
      {segments.map((segment, index) =>
        segment.emojiImageUrl ? (
          <img
            key={index}
            src={segment.emojiImageUrl}
            alt={segment.text}
            className="inline-block h-[1.15em] w-[1.15em] align-text-bottom"
          />
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

function authorNameClass(message: LiveChatMessage): string {
  if (message.isOwner) return "text-chrome-amber-400";
  if (message.isModerator) return "text-chrome-blue-400";
  if (message.isMember) return "text-chrome-emerald-400";
  return "text-chrome-neutral-400";
}

function AuthorBadges({ message }: { message: LiveChatMessage }) {
  return (
    <>
      {message.isModerator && <ShieldCheck size={11} className="shrink-0 text-chrome-blue-400" />}
      {message.isVerified && <BadgeCheck size={11} className="shrink-0 text-chrome-neutral-400" />}
      {message.isMember && message.memberBadgeUrl && (
        <img src={message.memberBadgeUrl} alt="" className="h-3 w-3 shrink-0 rounded-full" />
      )}
    </>
  );
}

function ChatRow({ message }: { message: LiveChatMessage }) {
  if (message.messageType === "superChat") {
    const background = argbToCss(message.superChatArgb);
    const darkText = prefersDarkText(message.superChatArgb);
    return (
      <div
        className="rounded-lg px-3 py-2"
        style={{ backgroundColor: background || "rgba(245, 158, 11, 0.15)" }}
      >
        <div className={`flex items-center justify-between gap-2 text-xs font-bold ${darkText ? "text-chrome-black" : "text-chrome-white"}`}>
          <span className="truncate">{message.author}</span>
          {message.superChatAmount && <span className="shrink-0">{message.superChatAmount}</span>}
        </div>
        {message.message && (
          <div className={`mt-1 break-words text-sm ${darkText ? "text-chrome-black/90" : "text-chrome-white/90"}`}>
            <MessageBody segments={message.segments} message={message.message} />
          </div>
        )}
      </div>
    );
  }

  if (message.messageType === "membership") {
    return (
      <div className="rounded-lg border-l-2 border-chrome-emerald-500/50 bg-chrome-emerald-500/10 px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-chrome-emerald-400">
          <span className="truncate">{message.author}</span>
          <AuthorBadges message={message} />
        </div>
        {message.message && (
          <div className="mt-0.5 break-words text-sm text-chrome-neutral-200">
            <MessageBody segments={message.segments} message={message.message} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex gap-2 px-1">
      {message.authorPhotoUrl ? (
        <img
          src={message.authorPhotoUrl}
          alt=""
          className="mt-0.5 h-6 w-6 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-surface-container-high" />
      )}
      <p className="min-w-0 break-words text-sm leading-snug text-chrome-neutral-200">
        <span
          className={`mr-1.5 inline-flex items-center gap-1 align-middle text-xs font-semibold ${authorNameClass(message)}`}
        >
          {message.author}
          <AuthorBadges message={message} />
        </span>
        <MessageBody segments={message.segments} message={message.message} />
      </p>
    </div>
  );
}

export function LiveChat({ videoId }: LiveChatProps) {
  const { messages, loading, ended, reconnect } = useLiveChat(videoId, true);

  const listRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  // Keep the view glued to the newest message unless the user has scrolled up to read history.
  useLayoutEffect(() => {
    if (pinned && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, pinned]);

  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    const onScroll = () => {
      const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
      setPinned(nearBottom);
    };
    element.addEventListener("scroll", onScroll);
    return () => element.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="flex h-[min(560px,70vh)] w-full flex-col overflow-hidden rounded-2xl border border-chrome-neutral-800 bg-surface-container-low">
      <div className="flex shrink-0 items-center gap-2 border-b border-chrome-neutral-800 px-4 py-3">
        <Radio size={16} className="text-primary" />
        <h3 className="text-base font-medium text-chrome-neutral-200">{getString("live_chat_title")}</h3>
        {ended ? (
          <button
            type="button"
            onClick={reconnect}
            className="ml-auto flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold text-chrome-neutral-300 transition-colors hover:bg-surface-container-high hover:text-chrome-neutral-100"
          >
            <RotateCw size={12} />
            {getString("live_chat_reconnect")}
          </button>
        ) : (
          <span className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            {getString("live_badge")}
          </span>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={listRef} className="hide-scrollbar h-full space-y-2.5 overflow-y-auto px-3 py-3">
          {loading && messages.length === 0 ? (
            <div className="flex items-center gap-2 px-1 py-2 text-sm text-chrome-neutral-500">
              <Loader2 size={16} className="animate-spin" />
              {getString("live_chat_connecting")}
            </div>
          ) : messages.length === 0 ? (
            <p className="px-1 py-2 text-sm text-chrome-neutral-500">
              {ended ? getString("live_chat_ended") : getString("live_chat_empty")}
            </p>
          ) : (
            messages.map((message) => <ChatRow key={message.id} message={message} />)
          )}
          {ended && messages.length > 0 && (
            <p className="px-1 pt-2 text-xs text-chrome-neutral-500">{getString("live_chat_ended")}</p>
          )}
        </div>

        {!pinned && (
          <button
            onClick={() => setPinned(true)}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-1.5 text-xs font-semibold text-chrome-neutral-200 transition-colors hover:bg-surface-container-highest"
          >
            <ArrowDown size={13} />
            {getString("live_chat_jump_latest")}
          </button>
        )}
      </div>
    </div>
  );
}

export default LiveChat;
