import { useMemo, useRef, type RefObject } from "react";
import { DISPLAY_H, DISPLAY_W, type AmbientLook } from "../../lib/ambient/pipeline";
import { useAmbientFrame } from "../../lib/ambient/useAmbientFrame";
import { useTheme } from "../../lib/useTheme";

interface AmbientGlowProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  intensity: number;
  /** Spreads past the player onto the page; otherwise it only fills the player's own bars. */
  spread: boolean;
}

/** The small canvas is scaled up by the browser, and that bilinear upscale is the blur. */
export function AmbientGlow({ videoRef, intensity, spread }: AmbientGlowProps) {
  const { variant } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const look = useMemo<AmbientLook>(
    () => ({ variant: variant === "light" ? "light" : "dark", intensity }),
    [variant, intensity],
  );
  useAmbientFrame(videoRef, canvasRef, look);

  return (
    <div
      aria-hidden="true"
      data-player-ambient
      className={`pointer-events-none absolute z-0 ${spread ? "ambient-glow-spread" : "inset-0 overflow-hidden"}`}
    >
      <canvas ref={canvasRef} width={DISPLAY_W} height={DISPLAY_H} className="block h-full w-full" />
    </div>
  );
}
