import React, { useState, useEffect, useRef, useCallback } from "react";
import type { StoryboardFrame } from "../../lib/seekPreview";
import type { StoryboardLevel } from "../../types/video";
import { IS_LINUX_RUNTIME } from "../../lib/platform";

export interface VideoThumbnailPreviewProps {
  frame: StoryboardFrame | null;
  level: StoryboardLevel | null;
  isActive: boolean;
  progressPercent?: number;
  className?: string;
}

interface FrameTile {
  key: string;
  url: string;
  x: number;
  y: number;
  levelWidth: number;
  levelHeight: number;
  columns: number;
  rows: number;
}

function getTileGeometry(
  tile: FrameTile,
  containerWidth: number,
  containerHeight: number
) {
  if (containerWidth <= 0 || containerHeight <= 0) {
    return {
      viewportStyle: {
        position: "absolute" as const,
        inset: 0,
        overflow: "hidden" as const,
      },
      imgStyle: {
        position: "absolute" as const,
        width: `${tile.columns * 100}%`,
        height: `${tile.rows * 100}%`,
        left: `-${(tile.x / tile.levelWidth) * 100}%`,
        top: `-${(tile.y / tile.levelHeight) * 100}%`,
      },
    };
  }

  // Exact card pixel dimension calculation:
  // 1. Fits vertically: tileHeight always matches card container height (100% vertical fit)
  const tileHeight = containerHeight;

  // 2. Proportional width: calculated from native aspect ratio (NO stretching or squishing!)
  const tileWidth =
    tile.levelHeight > 0
      ? (tileHeight * tile.levelWidth) / tile.levelHeight
      : containerWidth;

  // 3. Center horizontally inside the card container
  const tileLeft = (containerWidth - tileWidth) / 2;

  // 4. Full sprite sheet dimensions
  const sheetWidth = tileWidth * tile.columns;
  const sheetHeight = tileHeight * tile.rows;

  // 5. Image offset relative to the isolated single-tile viewport
  const imgLeft = -((tile.x / tile.levelWidth) * tileWidth);
  const imgTop = -((tile.y / tile.levelHeight) * tileHeight);

  return {
    viewportStyle: {
      position: "absolute" as const,
      top: 0,
      left: `${tileLeft}px`,
      width: `${tileWidth}px`,
      height: `${tileHeight}px`,
      overflow: "hidden" as const,
    },
    imgStyle: {
      position: "absolute" as const,
      width: `${sheetWidth}px`,
      height: `${sheetHeight}px`,
      left: `${imgLeft}px`,
      top: `${imgTop}px`,
    },
  };
}

export const VideoThumbnailPreview: React.FC<VideoThumbnailPreviewProps> = ({
  frame,
  level,
  isActive,
  progressPercent = 0,
  className = "",
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [isRendered, setIsRendered] = useState(false);
  const [current, setCurrent] = useState<FrameTile | null>(null);
  const [previous, setPrevious] = useState<FrameTile | null>(null);
  const prevProgressRef = useRef(progressPercent);
  const isLoopReset = progressPercent < prevProgressRef.current;
  prevProgressRef.current = progressPercent;

  const setContainerNode = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setContainerSize({ width: rect.width, height: rect.height });
      }
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isActive, Boolean(current)]);

  useEffect(() => {
    if (isActive) {
      const raf = requestAnimationFrame(() => setIsRendered(true));
      return () => {
        cancelAnimationFrame(raf);
        setIsRendered(false);
      };
    }
    setIsRendered(false);
    return undefined;
  }, [isActive]);

  useEffect(() => {
    if (!isActive || !frame || !level) {
      setCurrent(null);
      setPrevious(null);
      return;
    }

    const nextTile: FrameTile = {
      key: `${frame.url}#${frame.x},${frame.y}`,
      url: frame.url,
      x: frame.x,
      y: frame.y,
      levelWidth: level.width,
      levelHeight: level.height,
      columns: level.columns,
      rows: level.rows,
    };

    setCurrent((prev) => {
      if (!prev) return nextTile;
      if (prev.key !== nextTile.key) {
        setPrevious(prev);
        return nextTile;
      }
      return prev;
    });
  }, [isActive, frame?.url, frame?.x, frame?.y, level?.width, level?.height, level?.columns, level?.rows]);

  if (!isActive || (!frame && !current) || (!level && !current)) {
    return null;
  }

  const scaleClass = IS_LINUX_RUNTIME
    ? ""
    : " transition-transform duration-300 group-hover:scale-[1.03]";

  const currentGeom = current
    ? getTileGeometry(current, containerSize.width, containerSize.height)
    : null;
  const prevGeom = previous
    ? getTileGeometry(previous, containerSize.width, containerSize.height)
    : null;

  return (
    <div
      ref={setContainerNode}
      className={`pointer-events-none absolute inset-0 z-0 overflow-hidden transition-opacity duration-150 ease-out ${
        isRendered ? "opacity-100" : "opacity-0"
      }${scaleClass} ${className}`}
      aria-hidden="true"
    >
      {/* Back buffer: strictly isolated to 1 tile viewport */}
      {previous && prevGeom && current && previous.key !== current.key && (
        <div style={prevGeom.viewportStyle}>
          <img
            key={previous.url}
            src={previous.url}
            alt=""
            tabIndex={-1}
            decoding="async"
            className="pointer-events-none select-none max-w-none"
            style={prevGeom.imgStyle}
          />
        </div>
      )}

      {/* Front buffer: strictly isolated to 1 tile viewport */}
      {current && currentGeom && (
        <div style={currentGeom.viewportStyle}>
          <img
            key={current.url}
            src={current.url}
            alt=""
            tabIndex={-1}
            decoding="async"
            className="pointer-events-none select-none max-w-none"
            style={currentGeom.imgStyle}
          />
        </div>
      )}

      {/* Sleek micro-progress bar indicating preview playback progress */}
      {progressPercent > 0 && (
        <div className="absolute bottom-0 left-0 right-0 z-20 h-[2px] bg-chrome-black/40 pointer-events-none">
          <div
            className="h-full bg-primary transition-all ease-linear"
            style={{
              width: `${Math.min(100, Math.max(0, progressPercent))}%`,
              transitionDuration: isLoopReset ? "0ms" : "220ms",
            }}
          />
        </div>
      )}
    </div>
  );
};
