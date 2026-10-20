import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellOff, Check, ChevronDown, UserMinus } from "lucide-react";
import { Button } from "./Button";
import { AnchoredPortalMenu, type MenuAnchor } from "./AnchoredPortalMenu";
import { useSubscriptionStore } from "../../store/useSubscriptionStore";
import { useNotificationStore } from "../../store/useNotificationStore";
import { getString } from "../../lib/i18n/index";

export interface SubscribeButtonProps {
  channelId: string;
  channelName: string;
  avatarUrl?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  showNotificationMenu?: boolean;
}

function cleanChannelId(channelId: string) {
  return channelId.replace("channel:", "");
}

export function SubscribeButton({
  channelId,
  channelName,
  avatarUrl,
  size = "md",
  className = "",
  showNotificationMenu = true,
}: SubscribeButtonProps) {
  const { isSubscribed, subscribe, unsubscribe, loadSubscriptions } = useSubscriptionStore();
  const loadChannelPreferences = useNotificationStore((state) => state.loadChannelPreferences);
  const channelPrefsLoaded = useNotificationStore((state) => state.channelPrefsLoaded);
  const setChannelNotification = useNotificationStore((state) => state.setChannelNotification);
  const notificationsEnabled = useNotificationStore(
    (state) => state.channelNotifications[cleanChannelId(channelId)] !== false,
  );

  const wrapRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);

  useEffect(() => {
    loadSubscriptions();
  }, [loadSubscriptions]);

  useEffect(() => {
    if (!channelPrefsLoaded) void loadChannelPreferences();
  }, [channelPrefsLoaded, loadChannelPreferences]);

  const active = isSubscribed(channelId);
  const menuOpen = anchor !== null;
  const closeMenu = useCallback(() => setAnchor(null), []);

  const handleClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();

    if (!active) {
      subscribe(channelId, channelName, avatarUrl, { learn: true });
      return;
    }

    if (!showNotificationMenu) {
      unsubscribe(channelId, { learn: true });
      return;
    }

    if (menuOpen) {
      closeMenu();
      return;
    }
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ top: rect.bottom + 8, right: rect.right });
  };

  return (
    <div className="relative inline-block" ref={wrapRef}>
      <Button
        variant={active ? "secondary" : "primary"}
        size={size}
        onClick={handleClick}
        aria-haspopup={active && showNotificationMenu ? "menu" : undefined}
        aria-expanded={active && showNotificationMenu ? menuOpen : undefined}
        className={`font-semibold px-6 transition-all ${
          active
            ? "bg-chrome-zinc-800 hover:bg-chrome-zinc-700 text-chrome-neutral-200"
            : "bg-primary text-[var(--color-on-primary)]"
        } ${className}`}
      >
        {active ? (
          <>
            {notificationsEnabled ? (
              <Bell size={16} className="mr-2" />
            ) : (
              <BellOff size={16} className="mr-2" />
            )}
            {getString("subscribed")}
            {showNotificationMenu && <ChevronDown size={16} className="ml-1 -mr-2" />}
          </>
        ) : (
          getString("search_subscribe")
        )}
      </Button>

      {menuOpen && anchor && (
        <AnchoredPortalMenu
          anchor={anchor}
          onClose={closeMenu}
          className="z-[70] w-56 overflow-hidden rounded-xl border border-chrome-neutral-800 bg-surface-container-high py-1.5"
        >
          <div className="px-3.5 py-1.5 text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
            {getString("subscription_notifications_label")}
          </div>

          <MenuRow
            icon={<Bell size={16} />}
            label={getString("subscription_notifications_on")}
            selected={notificationsEnabled}
            onSelect={() => {
              void setChannelNotification(channelId, true);
              closeMenu();
            }}
          />
          <MenuRow
            icon={<BellOff size={16} />}
            label={getString("subscription_notifications_off")}
            selected={!notificationsEnabled}
            onSelect={() => {
              void setChannelNotification(channelId, false);
              closeMenu();
            }}
          />

          <div className="my-1.5 h-px bg-chrome-neutral-800" />

          <MenuRow
            icon={<UserMinus size={16} />}
            label={getString("subscriptions_unsubscribe")}
            destructive
            onSelect={() => {
              unsubscribe(channelId, { learn: true });
              closeMenu();
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
