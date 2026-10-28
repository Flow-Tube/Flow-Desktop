import { MOTION_EASE, motionMs } from "./motion";

export type FrameBox = { top: number; left: number; width: number; height: number };

const PLAYER_RADIUS_PX = 12;
const CHROME_FADE_EXTRA_MS = 120;
const CROSS_FADE_MS = 160;
// Below about 40 fps a glide reads as stutter; the rest of the session cross-fades instead.
const SLOW_FRAME_MS = 25;

let glideTooSlow = false;

export function meanFrameInterval(stamps: number[]): number | null {
  if (stamps.length < 3) return null;
  return (stamps[stamps.length - 1]! - stamps[0]!) / (stamps.length - 1);
}

export function isGlideTooSlow(stamps: number[]): boolean {
  const mean = meanFrameInterval(stamps);
  return mean !== null && mean > SLOW_FRAME_MS;
}

export function frameKeyframes(from: FrameBox, to: FrameBox, toTheater: boolean): Keyframe[] {
  const box = (b: FrameBox, radius: number): Keyframe => ({
    transform: `translate3d(${b.left}px, ${b.top}px, 0)`,
    width: `${b.width}px`,
    height: `${b.height}px`,
    borderRadius: `${radius}px`,
  });
  return [box(from, toTheater ? PLAYER_RADIUS_PX : 0), box(to, toTheater ? 0 : PLAYER_RADIUS_PX)];
}

/*
  Moves the player frame from its old box to the new one. The frame already holds the
  new box inline; the animation only covers the trip there, so a resize or scroll in
  the middle lands on the right place. Controls and captions fade out for the trip so
  they never stretch.
*/
export function glideFrame(frame: HTMLElement, from: FrameBox, to: FrameBox, toTheater: boolean) {
  const duration = motionMs("--motion-layout");
  if (duration <= 0 || typeof frame.animate !== "function") return;
  frame.getAnimations().forEach((animation) => animation.cancel());

  if (glideTooSlow) {
    frame.animate([{ opacity: 0 }, { opacity: 1 }], { duration: CROSS_FADE_MS, easing: MOTION_EASE });
    return;
  }

  frame.style.overflow = "hidden";
  const glide = frame.animate(frameKeyframes(from, to, toTheater), { duration, easing: MOTION_EASE });
  frame.querySelectorAll<HTMLElement>("#flow-player-root > :not(video)").forEach((chrome) => {
    chrome.animate(
      [{ opacity: 1 }, { opacity: 0, offset: 0.2 }, { opacity: 0, offset: 0.75 }, { opacity: 1 }],
      { duration: duration + CHROME_FADE_EXTRA_MS, easing: "linear" },
    );
  });

  const stamps: number[] = [];
  let raf = requestAnimationFrame(function sample(now) {
    stamps.push(now);
    raf = requestAnimationFrame(sample);
  });
  const done = (measured: boolean) => {
    cancelAnimationFrame(raf);
    frame.style.overflow = "";
    // The first frame also carries the layout change itself, and a hidden window throttles frames.
    if (measured && document.visibilityState === "visible" && isGlideTooSlow(stamps.slice(1))) {
      glideTooSlow = true;
    }
  };
  glide.onfinish = () => done(true);
  glide.oncancel = () => done(false);
}
