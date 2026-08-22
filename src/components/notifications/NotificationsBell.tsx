import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, BellOff, X } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import { AnchoredPortalMenu, type MenuAnchor } from "../ui/AnchoredPortalMenu";
import { useNotificationStore } from "../../store/useNotificationStore";
import {
  onNewNotifications,
  onNotificationActivated,
  type NotificationRecord,
} from "../../lib/api/notifications";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { prefetchStreamInfo } from "../../lib/streamResolution";
import { getString } from "../../lib/i18n/index";

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

type GroupKey = "today" | "yesterday" | "earlier";

function groupLabel(key: GroupKey): string {
  switch (key) {
    case "today":
      return getString("notifications_group_today");
    case "yesterday":
      return getString("notifications_group_yesterday");
    default:
      return getString("notifications_group_earlier");
  }
}

function groupNotifications(notifications: NotificationRecord[]) {
  const today = startOfDay(Date.now());
  const yesterday = today - 24 * 60 * 60 * 1000;
  const groups: Record<GroupKey, NotificationRecord[]> = { today: [], yesterday: [], earlier: [] };

  for (const item of notifications) {
    const day = startOfDay(item.createdAt);
    if (day >= today) groups.today.push(item);
    else if (day >= yesterday) groups.yesterday.push(item);
    else groups.earlier.push(item);
  }

  return (["today", "yesterday", "earlier"] as GroupKey[])
    .map((key) => ({ key, items: groups[key] }))
    .filter((group) => group.items.length > 0);
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function NotificationThumbnail({ src, alt }: { src: string | null; alt: string }) {
  const imageSrc = useProxiedImageUrl(src);
  if (!imageSrc) {
    return <div className="h-full w-full bg-surface-container-highest" />;
  }
  return <img src={imageSrc} alt={alt} className="h-full w-full object-cover" loading="lazy" />;
}

function NotificationItem({
  notification,
  onOpen,
  onDismiss,
}: {
  notification: NotificationRecord;
  onOpen: (videoId: string) => void;
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(notification.videoId)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(notification.videoId);
        }
      }}
      className={`group flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors duration-200 ease-out hover:bg-surface-container ${
        notification.isRead ? "" : "bg-[var(--color-primary)]/5"
      }`}
    >
      <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-surface-container-high">
        <NotificationThumbnail src={notification.thumbnailUrl} alt={notification.title} />
      </div>

      <div className="min-w-0 flex-1">
        <p
          className={`line-clamp-2 text-sm text-chrome-neutral-100 ${
            notification.isRead ? "font-normal" : "font-semibold"
          }`}
        >
          {notification.title}
        </p>
        <p className="mt-1 line-clamp-1 text-xs text-chrome-neutral-400">
          {notification.channelName}
          {" • "}
          {formatTime(notification.createdAt)}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 self-center">
        {!notification.isRead && (
          <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]" aria-hidden />
        )}
        <button
          type="button"
          title={getString("notifications_dismiss")}
          onClick={(event) => {
            event.stopPropagation();
            onDismiss(notification.id);
          }}
          className="grid h-7 w-7 place-items-center rounded-full text-chrome-neutral-500 opacity-0 transition-colors duration-200 ease-out hover:bg-surface-container-highest hover:text-chrome-neutral-200 group-hover:opacity-100"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

export function NotificationsBell() {
  const navigate = useNavigate();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);

  const notifications = useNotificationStore((state) => state.notifications);
  const unreadCount = useNotificationStore((state) => state.unreadCount);
  const loadNotifications = useNotificationStore((state) => state.loadNotifications);
  const prependNotifications = useNotificationStore((state) => state.prependNotifications);
  const markAllRead = useNotificationStore((state) => state.markAllRead);
  const removeNotification = useNotificationStore((state) => state.removeNotification);
  const clearAll = useNotificationStore((state) => state.clearAll);

  useEffect(() => {
    void loadNotifications();
    let unlisten: (() => void) | undefined;
    let active = true;
    void onNewNotifications((records) => prependNotifications(records)).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [loadNotifications, prependNotifications]);

  // Clicking a native system toast opens and plays that video in the app.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let active = true;
    void onNotificationActivated((videoId) => {
      prefetchStreamInfo(videoId);
      navigate(`/watch/${videoId}`);
    }).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [navigate]);

  const open = anchor !== null;

  const closePanel = useCallback(() => {
    setAnchor(null);
    void markAllRead();
  }, [markAllRead]);

  const toggle = useCallback(() => {
    if (open) {
      closePanel();
      return;
    }
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ top: rect.bottom + 8, right: rect.right });
  }, [open, closePanel]);

  const handleOpenVideo = useCallback(
    (videoId: string) => {
      closePanel();
      prefetchStreamInfo(videoId);
      navigate(`/watch/${videoId}`);
    },
    [closePanel, navigate],
  );

  const groups = useMemo(() => groupNotifications(notifications), [notifications]);
  const badge = unreadCount > 9 ? "9+" : String(unreadCount);

  return (
    <>
      <div className="relative" ref={wrapRef}>
        <IconButton
          title={getString("notifications_title")}
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <Bell />
        </IconButton>
        {unreadCount > 0 && (
          <span className="pointer-events-none absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-primary)] px-1 text-[10px] font-semibold leading-none text-[var(--color-on-primary)]">
            {badge}
          </span>
        )}
      </div>

      {open && anchor && (
        <AnchoredPortalMenu
          anchor={anchor}
          onClose={closePanel}
          closeOnScroll={false}
          className="z-[70] flex max-h-[70vh] w-[22rem] flex-col overflow-hidden rounded-2xl border border-chrome-neutral-800 bg-surface-container-high"
        >
          <div className="flex items-center justify-between border-b border-chrome-neutral-800 px-4 py-3">
            <h2 className="text-base font-medium text-chrome-neutral-200">
              {getString("notifications_title")}
            </h2>
            {notifications.length > 0 && (
              <button
                type="button"
                onClick={() => void clearAll()}
                className="rounded-full px-2 py-1 text-xs font-medium text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-highest hover:text-chrome-neutral-200"
              >
                {getString("notifications_clear_all")}
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                <BellOff className="mb-3 text-chrome-neutral-600" size={32} />
                <h3 className="text-sm font-medium text-chrome-neutral-200">
                  {getString("notifications_empty_title")}
                </h3>
                <p className="mt-1 max-w-[16rem] text-xs text-chrome-neutral-400">
                  {getString("notifications_empty_body")}
                </p>
              </div>
            ) : (
              groups.map((group) => (
                <section key={group.key}>
                  <div className="sticky top-0 z-10 bg-surface-container-high px-4 py-2 text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
                    {groupLabel(group.key)}
                  </div>
                  <div className="divide-y divide-chrome-neutral-800/60">
                    {group.items.map((notification) => (
                      <NotificationItem
                        key={notification.id}
                        notification={notification}
                        onOpen={handleOpenVideo}
                        onDismiss={(id) => void removeNotification(id)}
                      />
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        </AnchoredPortalMenu>
      )}
    </>
  );
}

export default NotificationsBell;
