import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface MenuAnchor {
  top: number;
  left?: number;
  right?: number;
}

const VIEWPORT_MARGIN = 8;

interface AnchoredPortalMenuProps {
  anchor: MenuAnchor;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
  closeOnScroll?: boolean;
}

export function AnchoredPortalMenu({
  anchor,
  onClose,
  className,
  children,
  closeOnScroll = true,
}: AnchoredPortalMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    position: "fixed",
    top: anchor.top,
    left: anchor.left ?? 0,
    visibility: "hidden",
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = anchor.right != null ? anchor.right - width : anchor.left ?? 0;
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - width - VIEWPORT_MARGIN));

    let top = anchor.top;
    if (top + height > vh - VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, top - height);
    }
    top = Math.max(VIEWPORT_MARGIN, Math.min(top, vh - height - VIEWPORT_MARGIN));

    setStyle({ position: "fixed", top, left, visibility: "visible" });
  }, [anchor.top, anchor.left, anchor.right]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      // Claimed here, so a player underneath doesn't also close on the same Escape.
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    if (closeOnScroll) window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      if (closeOnScroll) window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, closeOnScroll]);

  return createPortal(
    <div
      ref={ref}
      style={style}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      className={className}
    >
      {children}
    </div>,
    document.body,
  );
}

export default AnchoredPortalMenu;
