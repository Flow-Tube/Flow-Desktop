import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BellOff, BellRing, Check, ChevronDown, UserMinus } from "lucide-react";
import { Button } from "./Button";
import { AnchoredPortalMenu, type MenuAnchor } from "./AnchoredPortalMenu";
import { useSubscriptionStore } from "../../store/useSubscriptionStore";
import { useNotificationStore } from "../../store/useNotificationStore";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { useUiStore } from "../../store/useUiStore";
import { SETTINGS } from "../../lib/settings/schema";
import { MOTION_EASE, motionMs } from "../../lib/motion";
import { getString } from "../../lib/i18n/index";

export interface SubscribeButtonProps {
  channelId: string;
  channelName: string;
  avatarUrl?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  showNotificationMenu?: boolean;
}

// Slightly longer than a menu, because the button also changes colour as it resizes.
const WIDTH_MORPH_EXTRA_MS = 70;

function cleanChannelId(channelId: string) {
  return channelId.replace("channel:", "");
}

/** "Subscribe" and "Subscribed" differ in width; this eases between the two. */
function morphWidth(button: HTMLElement, from: number, to: number) {
  const duration = motionMs("--motion-menu-in");
  if (duration <= 0 || typeof button.animate !== "function") return;
  button.style.overflow = "hidden";
  const resize = button.animate([{ width: `${from}px` }, { width: `${to}px` }], {
    duration: duration + WIDTH_MORPH_EXTRA_MS,
    easing: MOTION_EASE,
  });
  const reset = () => {
    button.style.overflow = "";
  };
  resize.onfinish = reset;
  resize.oncancel = reset;
  button.firstElementChild?.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: MOTION_EASE });
}

export function SubscribeButton({
  channelId,
  channelName,
  avatarUrl,
  size = "md",
  className = "",
  showNotificationMenu = true,
}: SubscribeButtonProps) {
  const navigate = useNavigate();
  const active = useSubscriptionStore((state) => state.isSubscribed(channelId));
  const channelNotificationsOn = useNotificationStore(
    (state) => state.channelNotifications[cleanChannelId(channelId)] !== false,
  );
  const allNotificationsOn = useAppSettingsStore((state) => state.values[SETTINGS.NOTIFICATIONS_ENABLED] !== "false");
  const notificationsOn = channelNotificationsOn && allNotificationsOn;

  const boxRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const [ringKey, setRingKey] = useState(0);
  // Only a click morphs or rings; a store load that flips the state stays still.
  const morphNextRef = useRef(false);
  const lastWidthRef = useRef<number | null>(null);

  const menuOpen = anchor !== null;
  const closeMenu = useCallback(() => setAnchor(null), []);
  const ring = () => setRingKey((key) => key + 1);

  useLayoutEffect(() => {
    const button = boxRef.current?.firstElementChild;
    if (!(button instanceof HTMLElement)) return;
    const width = button.getBoundingClientRect().width;
    const from = lastWidthRef.current;
    lastWidthRef.current = width;
    if (!morphNextRef.current || from === null || Math.abs(from - width) < 1) return;
    morphNextRef.current = false;
    morphWidth(button, from, width);
  }, [active]);

  const subscribe = () => {
    morphNextRef.current = true;
    void useSubscriptionStore.getState().subscribe(channelId, channelName, avatarUrl, { learn: true });
    if (notificationsOn) ring();
  };

  const unsubscribe = async () => {
    morphNextRef.current = true;
    const removed = await useSubscriptionStore.getState().unsubscribe(channelId, { learn: true });
    if (!removed) return;
    useUiStore.getState().showToast({
      variant: "info",
      message: getString("subscription_unsubscribed_from", channelName),
      image: avatarUrl,
      imageShape: "square",
      actions: [
        {
          label: getString("undo"),
          onSelect: () => {
            morphNextRef.current = true;
            void useSubscriptionStore.getState().restoreSubscription(removed, { learn: true });
            if (notificationsOn) ring();
          },
        },
      ],
    });
  };

  const handleClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();

    if (!active) {
      subscribe();
      return;
    }

    if (!showNotificationMenu) {
      void unsubscribe();
      return;
    }

    if (menuOpen) {
      closeMenu();
      return;
    }
    const rect = boxRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ top: rect.bottom + 8, right: rect.right });
  };

  return (
    <div className="relative inline-block" ref={boxRef}>
      <Button
        variant={active ? "secondary" : "primary"}
        size={size}
        onClick={handleClick}
        aria-haspopup={active && showNotificationMenu ? "menu" : undefined}
        aria-expanded={active && showNotificationMenu ? menuOpen : undefined}
        className={`whitespace-nowrap px-6 font-semibold ${
          active
            ? "bg-chrome-zinc-800 text-chrome-neutral-200 hover:bg-chrome-zinc-700"
            : "bg-primary text-[var(--color-on-primary)]"
        } ${className}`}
      >
        <span className="inline-flex items-center gap-2">
          {active ? (
            <>
              <span key={ringKey} className={`grid ${ringKey > 0 ? "animate-bell-ring" : ""}`}>
                {notificationsOn ? <BellRing size={16} /> : <BellOff size={16} />}
              </span>
              {getString("subscribed")}
              {showNotificationMenu && <ChevronDown size={16} className="-mr-2 text-chrome-neutral-400" />}
            </>
          ) : (
            getString("search_subscribe")
          )}
        </span>
      </Button>

      {menuOpen && anchor && (
        <AnchoredPortalMenu
          anchor={anchor}
          onClose={closeMenu}
          className="z-[70] w-64 overflow-hidden rounded-xl border border-chrome-neutral-800 bg-surface-container-high py-1.5"
        >
          <div className="px-3.5 py-1.5 text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
            {getString("subscription_notifications_label")}
          </div>

          <MenuRow
            icon={<BellRing size={16} />}
            label={getString("subscription_notifications_all")}
            selected={channelNotificationsOn}
            onSelect={() => {
              if (!channelNotificationsOn && allNotificationsOn) ring();
              void useNotificationStore.getState().setChannelNotification(channelId, true);
              closeMenu();
            }}
          />
          <MenuRow
            icon={<BellOff size={16} />}
            label={getString("subscription_notifications_none")}
            selected={!channelNotificationsOn}
            onSelect={() => {
              void useNotificationStore.getState().setChannelNotification(channelId, false);
              closeMenu();
            }}
          />

          {!allNotificationsOn && (
            <div className="px-3.5 pb-2 pt-1 text-xs leading-relaxed text-chrome-neutral-400">
              {getString("subscription_notifications_master_off")}{" "}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  closeMenu();
                  navigate("/settings", { state: { settingsCategory: "content" } });
                }}
                className="font-medium text-chrome-neutral-200 underline underline-offset-2 transition-colors duration-200 ease-out hover:text-chrome-neutral-100"
              >
                {getString("subscription_notifications_open_settings")}
              </button>
            </div>
          )}

          <div className="my-1.5 h-px bg-chrome-neutral-800" />

          <MenuRow
            icon={<UserMinus size={16} />}
            label={getString("subscriptions_unsubscribe")}
            destructive
            onSelect={() => {
              closeMenu();
              void unsubscribe();
            }}
          />
        </AnchoredPortalMenu>
      )}
    </div>
  );
}

function MenuRow({
  icon,
  label,
  selected,
  destructive,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  selected?: boolean;
  destructive?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm transition-colors duration-200 ease-out ${
        destructive
          ? "text-chrome-red-400 hover:bg-chrome-red-950/30"
          : "text-chrome-zinc-300 hover:bg-chrome-zinc-800 hover:text-chrome-zinc-100"
      }`}
    >
      <span className="grid h-4 w-4 shrink-0 place-items-center text-chrome-neutral-400">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected && <Check size={16} className="shrink-0 text-[var(--color-primary)]" />}
    </button>
  );
}
