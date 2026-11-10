import { Volume1, Volume2, VolumeX } from "lucide-react";

import type { VolumeFeedback } from "../../lib/useVolumeFeedback";

type VolumeFeedbackPillProps = {
  feedback: VolumeFeedback;
  /** `video` sits on the picture; `surface` sits on the app's own background. */
  tone: "video" | "surface";
  /** Placement only; the pill draws its own look. */
  className?: string;
};

const TONES = {
  video: {
    pill: "bg-chrome-black/60 text-chrome-white",
    track: "bg-chrome-white/25",
    fill: "bg-chrome-white",
  },
  surface: {
    pill: "border border-chrome-neutral-800 bg-surface-container text-chrome-neutral-100",
    track: "bg-surface-container-highest",
    fill: "bg-chrome-neutral-100",
  },
};

/** The level a wheel or key change just set, shown for a moment. */
export function VolumeFeedbackPill({ feedback, tone, className = "" }: VolumeFeedbackPillProps) {
  const level = feedback.muted ? 0 : Math.round(feedback.volume * 100);
  const look = TONES[tone];
  const Icon = level === 0 ? VolumeX : feedback.volume < 0.55 ? Volume1 : Volume2;

  return (
    <div
      key={feedback.id}
      className={`pointer-events-none flex items-center gap-3 rounded-full px-5 py-2 animate-fade-in ${look.pill} ${className}`}
    >
      <Icon size={18} />
      <div className={`h-1 w-24 overflow-hidden rounded-full ${look.track}`}>
        <div className={`h-full rounded-full ${look.fill}`} style={{ width: `${Math.min(100, level)}%` }} />
      </div>
      <span className="min-w-[3ch] text-sm font-bold tabular-nums">{level}</span>
    </div>
  );
}
