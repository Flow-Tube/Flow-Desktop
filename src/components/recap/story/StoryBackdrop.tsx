import { useCallback, useMemo, useRef } from "react";

import { IS_LINUX_RUNTIME } from "../../../lib/platform";

const VIEW = 200;
const POINTS = 180;
/** Lobes and depth of the soft shapes behind a page. */
const SHAPES: ReadonlyArray<readonly [number, number]> = [[12, 0.05], [8, 0.11], [9, 0.07], [6, 0.1], [4, 0.16], [7, 0.08]];

function shapePath([lobes, depth]: readonly [number, number]): string {
  const radius = (VIEW / 2) * (1 - depth);
  const points = Array.from({ length: POINTS }, (_, index) => {
    const angle = (index / POINTS) * 2 * Math.PI;
    const r = radius * (1 + depth * Math.cos(lobes * angle));
    return `${(VIEW / 2 + r * Math.cos(angle)).toFixed(1)} ${(VIEW / 2 + r * Math.sin(angle)).toFixed(1)}`;
  });
  return `M${points.join("L")}Z`;
}

/** Turns the shapes with the page's clock, so they stand still whenever the story is paused. */
export function useStoryBackdrop() {
  const near = useRef<SVGSVGElement>(null);
  const far = useRef<SVGSVGElement>(null);
  // Turning a shape this large repaints it on the CPU under WebKitGTK.
  const still = useMemo(() => IS_LINUX_RUNTIME || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches, []);
  const onFrame = useCallback(
    (fraction: number) => {
      if (still) return;
      if (near.current) near.current.style.transform = `rotate(${70 * fraction}deg) scale(${1 + 0.08 * fraction})`;
      if (far.current) far.current.style.transform = `rotate(${-50 * fraction}deg) scale(${1.08 - 0.08 * fraction})`;
    },
    [still],
  );
  return { near, far, onFrame };
}

interface StoryBackdropProps {
  seed: number;
  near: React.RefObject<SVGSVGElement | null>;
  far: React.RefObject<SVGSVGElement | null>;
}

export function StoryBackdrop({ seed, near, far }: StoryBackdropProps) {
  const nearPath = useMemo(() => shapePath(SHAPES[seed % SHAPES.length]!), [seed]);
  const farPath = useMemo(() => shapePath(SHAPES[(seed + 1) % SHAPES.length]!), [seed]);
  const box = `0 0 ${VIEW} ${VIEW}`;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <svg ref={near} viewBox={box} className="absolute -end-[32vmin] -top-[32vmin] h-[95vmin] w-[95vmin]">
        <path d={nearPath} className="fill-[var(--story-shape)]" />
      </svg>
      <svg ref={far} viewBox={box} className="absolute -bottom-[26vmin] -start-[26vmin] h-[70vmin] w-[70vmin]">
        <path d={farPath} className="fill-[var(--story-shape)]" />
      </svg>
    </div>
  );
}
