import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { MediaScrubber } from "../ui/MediaScrubber";

interface MusicScrubberProps {
  size?: "sm" | "lg";
  variant?: "bar" | "edge";
  showTimes?: boolean;
  countdown?: boolean;
  className?: string;
  expressive?: boolean;
}

export function MusicScrubber({
  size = "sm",
  variant = "bar",
  showTimes = false,
  countdown = false,
  className = "",
  expressive = false,
}: MusicScrubberProps) {
  const progress = useMusicPlayerStore((s) => s.progress);
  const duration = useMusicPlayerStore((s) => s.duration);
  const seek = useMusicPlayerStore((s) => s.seek);

  return (
    <MediaScrubber
      progress={progress}
      duration={duration}
      onSeek={seek}
      size={size}
      variant={variant}
      showTimes={showTimes}
      countdown={countdown}
      className={className}
      expressive={expressive}
    />
  );
}
