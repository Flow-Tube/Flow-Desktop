import { useMusicPlayerStore } from "../../../store/useMusicPlayerStore";

const SIZE = 48;
const STROKE = 2.5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** The song's progress as a ring around the Pill's cover, starting at the top and running clockwise. */
export function CoverRing() {
  const progress = useMusicPlayerStore((s) => s.progress);
  const duration = useMusicPlayerStore((s) => s.duration);
  const share = duration > 0 ? Math.min(1, Math.max(0, progress / duration)) : 0;
  return (
    <svg aria-hidden viewBox={`0 0 ${SIZE} ${SIZE}`} className="pointer-events-none absolute inset-0 h-full w-full -rotate-90">
      <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" strokeWidth={STROKE} className="stroke-chrome-neutral-700" />
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        fill="none"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={CIRCUMFERENCE * (1 - share)}
        className="stroke-[var(--color-primary)] transition-[stroke-dashoffset] duration-300 ease-linear"
      />
    </svg>
  );
}
