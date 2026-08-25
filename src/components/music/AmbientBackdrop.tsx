import type { CSSProperties } from "react";
import type { Rgb } from "../../lib/useDominantColor";
import { upgradeMusicImageUrl } from "../../lib/thumbnails";

/**
 * Ported from the Android player's `MusicPlayerBackgroundStyle`, so a user who
 * runs both apps gets the same four choices under the same names.
 */
export type MusicBackgroundStyle = "blur_gradient" | "blur" | "gradient" | "default";

export const MUSIC_BACKGROUND_STYLES: readonly MusicBackgroundStyle[] = [
  "blur_gradient",
  "blur",
  "gradient",
  "default",
];

export function isMusicBackgroundStyle(value: string): value is MusicBackgroundStyle {
  return (MUSIC_BACKGROUND_STYLES as readonly string[]).includes(value);
}

/** The palette tint, at the two weights the gradients mix between. */
function tint(accent: Rgb | null | undefined, alpha: number): string {
  if (!accent) return `rgba(0, 0, 0, ${alpha})`;
  return `rgba(${accent.r}, ${accent.g}, ${accent.b}, ${alpha})`;
}

function gradientFor(style: MusicBackgroundStyle, accent: Rgb | null | undefined): CSSProperties | null {
  switch (style) {
    // Artwork carries the colour here; the wash only has to keep text legible.
    case "blur_gradient":
      return {
        background: `linear-gradient(to bottom, rgba(0,0,0,0.40) 0%, ${tint(accent, 0.22)} 30%, ${tint(accent, 0.34)} 55%, rgba(0,0,0,0.80) 80%, rgba(0,0,0,0.95) 100%)`,
      };
    case "blur":
      return { background: "rgba(0, 0, 0, 0.58)" };
    // No artwork behind it, so the palette runs much stronger at the top.
    case "gradient":
      return {
        background: `linear-gradient(to bottom, ${tint(accent, 0.72)} 0%, ${tint(accent, 0.78)} 38%, rgba(0,0,0,0.88) 72%, rgb(0,0,0) 100%)`,
      };
    case "default":
      return {
        background: `linear-gradient(to bottom, rgb(0,0,0) 0%, ${tint(accent, 0.22)} 45%, rgb(0,0,0) 100%)`,
      };
  }
}

interface AmbientBackdropProps {
  src?: string | null;
  accent?: Rgb | null;
  style?: MusicBackgroundStyle;
}

export function AmbientBackdrop({ src, accent, style = "blur_gradient" }: AmbientBackdropProps) {
  const imageSrc = upgradeMusicImageUrl(src);
  const showArtwork = style === "blur_gradient" || style === "blur";
  const overlay = gradientFor(style, accent);

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-chrome-neutral-950">
      {showArtwork && imageSrc && (
        <img
          key={imageSrc}
          src={imageSrc}
          alt=""
          aria-hidden
          className={`absolute inset-0 h-full w-full scale-125 object-cover blur-[100px] saturate-150 ${
            style === "blur" ? "opacity-60" : "opacity-30"
          }`}
        />
      )}

      {style === "blur_gradient" && accent && (
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(120% 80% at 50% 0%, rgba(${accent.r},${accent.g},${accent.b},0.22), transparent 60%)`,
          }}
        />
      )}

      {overlay && <div className="absolute inset-0" style={overlay} />}
    </div>
  );
}
