/*
  Script-driven motion reads the same `--motion-*` tokens App.css declares, so a timing
  change made there reaches the Web Animations and framer transitions too.
*/

const FALLBACK_MS = {
  "--motion-menu-in": 150,
  "--motion-menu-out": 100,
  "--motion-pane": 180,
  "--motion-page": 200,
  "--motion-layout": 320,
  "--motion-panel": 360,
} as const;

export type MotionToken = keyof typeof FALLBACK_MS;

export const MOTION_EASE = "cubic-bezier(0.2, 0, 0, 1)";
export const MOTION_EASE_EXIT = "cubic-bezier(0.3, 0, 1, 1)";

/** framer-motion transitions matching the menu tokens. */
export const MENU_ENTER_TRANSITION = { duration: 0.15, ease: [0.2, 0, 0, 1] as const };
export const MENU_EXIT_TRANSITION = { duration: 0.1, ease: [0.3, 0, 1, 1] as const };

/** "150ms" or "0.15s" to milliseconds; null when the value is not a duration. */
export function parseDurationMs(value: string): number | null {
  const match = value.trim().match(/^(-?\d*\.?\d+)(ms|s)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2] === "s" ? amount * 1000 : amount;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function motionMs(token: MotionToken): number {
  if (prefersReducedMotion()) return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token);
  return parseDurationMs(raw) ?? FALLBACK_MS[token];
}

/*
  A menu that unmounts can't animate itself out, so a frozen copy of it fades out in
  its place. The copy is inert and takes no pointer, so the click that closed the menu
  and the next one both land on what is underneath.
*/
export function playExitGhost(node: HTMLElement) {
  const duration = motionMs("--motion-menu-out");
  if (duration <= 0 || typeof node.animate !== "function") return;
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const ghost = node.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("id");
  ghost.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  const origin = getComputedStyle(node).transformOrigin;
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    right: "auto",
    bottom: "auto",
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: "0",
    pointerEvents: "none",
    animation: "none",
    // Above everything, including the fullscreen player: it is gone in a tenth of a second.
    zIndex: "2147483647",
    transformOrigin: origin,
  });
  document.body.appendChild(ghost);
  const animation = ghost.animate(
    [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.98)" }],
    { duration, easing: MOTION_EASE_EXIT, fill: "forwards" },
  );
  const remove = () => ghost.remove();
  animation.onfinish = remove;
  animation.oncancel = remove;
}
