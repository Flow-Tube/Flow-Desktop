import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type React from "react";
import { setSettingValue, useAppSettingsStore } from "../store/useAppSettingsStore";
import { DRAG_THRESHOLD_PX } from "./pointerGesture";
import { SETTINGS } from "./settings/schema";

export interface MiniPlayerRatios {
  xRatio: number;
  yRatio: number;
}

export interface MiniPlayerBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export const MIN_VIEWPORT_GUTTER = 24;
/** Keeps the player clear of the title bar, which is 40 px tall. */
export const TOP_TITLEBAR_GUTTER = 48;

export function computeMiniPlayerBounds(
  viewportWidth: number,
  viewportHeight: number,
  playerWidth: number,
  playerHeight: number,
  gutter = MIN_VIEWPORT_GUTTER,
  topGutter = TOP_TITLEBAR_GUTTER,
): MiniPlayerBounds {
  const minX = gutter;
  const maxX = Math.max(minX, viewportWidth - playerWidth - gutter);
  const minY = topGutter;
  const maxY = Math.max(minY, viewportHeight - playerHeight - gutter);

  return { minX, maxX, minY, maxY };
}

export function positionFromRatios(
  ratios: MiniPlayerRatios,
  bounds: MiniPlayerBounds,
): { x: number; y: number } {
  const clampedXRatio = Math.max(0, Math.min(1, ratios.xRatio));
  const clampedYRatio = Math.max(0, Math.min(1, ratios.yRatio));
  const x = bounds.minX + clampedXRatio * (bounds.maxX - bounds.minX);
  const y = bounds.minY + clampedYRatio * (bounds.maxY - bounds.minY);
  return { x: Math.round(x), y: Math.round(y) };
}

export function ratiosFromPosition(
  x: number,
  y: number,
  bounds: MiniPlayerBounds,
): MiniPlayerRatios {
  const xSpan = bounds.maxX - bounds.minX;
  const ySpan = bounds.maxY - bounds.minY;
  const xRatio = xSpan > 0 ? Math.max(0, Math.min(1, (x - bounds.minX) / xSpan)) : 1;
  const yRatio = ySpan > 0 ? Math.max(0, Math.min(1, (y - bounds.minY) / ySpan)) : 1;
  return { xRatio, yRatio };
}

export function parseSavedPosition(raw: string | null | undefined): MiniPlayerRatios {
  if (!raw) return { xRatio: 1, yRatio: 1 };
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.xRatio === "number" &&
      typeof parsed?.yRatio === "number" &&
      Number.isFinite(parsed.xRatio) &&
      Number.isFinite(parsed.yRatio)
    ) {
      return {
        xRatio: Math.max(0, Math.min(1, parsed.xRatio)),
        yRatio: Math.max(0, Math.min(1, parsed.yRatio)),
      };
    }
  } catch {
    // Unreadable JSON falls through to the default corner.
  }
  return { xRatio: 1, yRatio: 1 };
}

export interface UseMiniPlayerDragOptions {
  frameRef: React.RefObject<HTMLDivElement | null>;
  isFloating: boolean;
}

export interface MiniPlayerDragBinds {
  onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp?: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerCancel?: (event: React.PointerEvent<HTMLDivElement>) => void;
}

export function useMiniPlayerDrag({
  frameRef,
  isFloating,
}: UseMiniPlayerDragOptions) {
  const [isDragging, setIsDragging] = useState(false);
  const currentPosRef = useRef<{ x: number; y: number } | null>(null);
  const savedPositionSetting = useAppSettingsStore((s) => s.values[SETTINGS.MINI_PLAYER_POSITION]);
  const ratiosRef = useRef<MiniPlayerRatios>(parseSavedPosition(savedPositionSetting));
  const pressRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const startPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isDraggingActiveRef = useRef(false);

  const getPlayerDimensions = () => {
    const frame = frameRef.current;
    if (frame) {
      const rect = frame.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return { width: rect.width, height: rect.height };
      }
    }
    const defaultWidth = Math.min(420, window.innerWidth - 32);
    return { width: defaultWidth, height: (defaultWidth * 9) / 16 };
  };

  const syncPositionToDom = (x: number, y: number) => {
    const frame = frameRef.current;
    if (!frame) return;
    frame.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    currentPosRef.current = { x, y };
  };

  // Settings load after the first render, and leaving the watch page clears the
  // slot tracker's transform after the layout effect below has run.
  useEffect(() => {
    if (!isDraggingActiveRef.current) {
      ratiosRef.current = parseSavedPosition(savedPositionSetting);
      if (isFloating) {
        const dims = getPlayerDimensions();
        const bounds = computeMiniPlayerBounds(window.innerWidth, window.innerHeight, dims.width, dims.height);
        const pos = positionFromRatios(ratiosRef.current, bounds);
        syncPositionToDom(pos.x, pos.y);
      }
    }
  }, [savedPositionSetting, isFloating]);

  useLayoutEffect(() => {
    if (!isFloating) {
      if (frameRef.current) {
        frameRef.current.style.transform = "";
      }
      currentPosRef.current = null;
      return;
    }

    const updateFromRatios = () => {
      const dims = getPlayerDimensions();
      const bounds = computeMiniPlayerBounds(window.innerWidth, window.innerHeight, dims.width, dims.height);
      const pos = positionFromRatios(ratiosRef.current, bounds);
      syncPositionToDom(pos.x, pos.y);
    };

    updateFromRatios();

    let resizeRaf: number | null = null;
    const onResize = () => {
      if (resizeRaf !== null) return;
      resizeRaf = window.requestAnimationFrame(() => {
        resizeRaf = null;
        updateFromRatios();
      });
    };

    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (resizeRaf !== null) window.cancelAnimationFrame(resizeRaf);
    };
  }, [isFloating, frameRef]);

  if (!isFloating) {
    return {
      isDragging: false,
      dragBinds: {} as MiniPlayerDragBinds,
    };
  }

  const finishPress = (event: React.PointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    if (!press || press.id !== event.pointerId) return;
    pressRef.current = null;
    if (!isDraggingActiveRef.current) return;

    isDraggingActiveRef.current = false;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const dims = getPlayerDimensions();
    const bounds = computeMiniPlayerBounds(window.innerWidth, window.innerHeight, dims.width, dims.height);
    const currentPos = currentPosRef.current || positionFromRatios(ratiosRef.current, bounds);
    const newRatios = ratiosFromPosition(currentPos.x, currentPos.y, bounds);
    ratiosRef.current = newRatios;
    void setSettingValue(SETTINGS.MINI_PLAYER_POSITION, JSON.stringify(newRatios));
  };

  const dragBinds: MiniPlayerDragBinds = {
    onPointerDown: (event) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-drag-ignore='true']")) return;

      const dims = getPlayerDimensions();
      const bounds = computeMiniPlayerBounds(window.innerWidth, window.innerHeight, dims.width, dims.height);
      const currentPos = currentPosRef.current || positionFromRatios(ratiosRef.current, bounds);

      pressRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      startPosRef.current = currentPos;
      isDraggingActiveRef.current = false;
    },

    onPointerMove: (event) => {
      const press = pressRef.current;
      if (!press || press.id !== event.pointerId) return;

      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;

      if (!isDraggingActiveRef.current) {
        if (Math.hypot(dx, dy) <= DRAG_THRESHOLD_PX) return;
        isDraggingActiveRef.current = true;
        setIsDragging(true);
        // The gesture overlay holds the pointer for a press on the video and needs
        // its release. Anything else needs capturing, or the drag ends at the frame's edge.
        const target = event.target as Element | null;
        if (!target?.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.setPointerCapture(event.pointerId);
        }
      }

      const dims = getPlayerDimensions();
      const bounds = computeMiniPlayerBounds(window.innerWidth, window.innerHeight, dims.width, dims.height);
      const nextX = Math.max(bounds.minX, Math.min(bounds.maxX, startPosRef.current.x + dx));
      const nextY = Math.max(bounds.minY, Math.min(bounds.maxY, startPosRef.current.y + dy));

      syncPositionToDom(nextX, nextY);
    },

    onPointerUp: finishPress,
    onPointerCancel: finishPress,
  };

  return {
    isDragging,
    dragBinds,
  };
}
