import React, { useCallback, useRef, useState } from 'react';
import type { MenuAnchor } from '../ui/AnchoredPortalMenu';
import { MediaMenu, type MediaMenuAction, type MediaMenuHeader } from '../ui/MediaMenu';

export type MusicMenuAction = MediaMenuAction;

export function useMusicContextMenu(enabled = true) {
  const [showMenu, setShowMenu] = useState(false);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => setShowMenu(false), []);

  const openMenuFromDots = useCallback(
    (event: React.MouseEvent) => {
      if (!enabled) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      setAnchor({ top: rect.bottom + 4, right: rect.right });
      setShowMenu((current) => !current);
    },
    [enabled],
  );

  const openMenuFromContext = useCallback(
    (event: React.MouseEvent) => {
      if (!enabled) return;
      event.preventDefault();
      event.stopPropagation();
      setAnchor({ top: event.clientY, left: event.clientX });
      setShowMenu(true);
    },
    [enabled],
  );

  return {
    cardRef,
    closeMenu,
    anchor,
    openMenuFromContext,
    openMenuFromDots,
    showMenu,
  };
}

export function MusicCardMenu({
  actions,
  anchor,
  className = 'z-[70]',
  header,
  onClose,
  show,
}: {
  actions: MusicMenuAction[];
  anchor: MenuAnchor | null;
  className?: string;
  header?: MediaMenuHeader;
  onClose: () => void;
  show: boolean;
}) {
  if (!show || !anchor || actions.length === 0) return null;

  return <MediaMenu anchor={anchor} onClose={onClose} actions={actions} header={header} className={className} />;
}
