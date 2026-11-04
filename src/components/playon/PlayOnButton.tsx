import { useState } from "react";
import { Speaker } from "lucide-react";

import { getString } from "../../lib/i18n/index";
import { usePlayOnAvailable, useRemoteActive } from "../../lib/live/usePlayOn";
import { AnchoredPortalMenu, type MenuAnchor } from "../ui/AnchoredPortalMenu";
import { PlayOnPopover } from "./PlayOnPopover";

/** The devices button of a player bar; hidden while no other device can be reached. */
export function PlayOnButton({ className, iconSize = 18 }: { className: string; iconSize?: number }) {
  const available = usePlayOnAvailable();
  const remote = useRemoteActive();
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);

  if (!available) return null;
  return (
    <>
      <button
        type="button"
        data-sheet-drag-ignore
        aria-label={getString("play_on_title")}
        aria-expanded={anchor !== null}
        onClick={(event) => {
          // Opens above the bar, as the dock's other popovers do.
          const rect = event.currentTarget.getBoundingClientRect();
          setAnchor(anchor ? null : { top: rect.bottom + 12, right: rect.right, flipBottom: rect.top - 12 });
        }}
        className={`${className} ${anchor || remote ? "text-[var(--color-primary)]" : ""}`}
      >
        <Speaker style={{ width: iconSize, height: iconSize }} />
      </button>
      {anchor && (
        <AnchoredPortalMenu anchor={anchor} onClose={() => setAnchor(null)} closeOnScroll={false} className="z-[70]">
          <PlayOnPopover />
        </AnchoredPortalMenu>
      )}
    </>
  );
}
