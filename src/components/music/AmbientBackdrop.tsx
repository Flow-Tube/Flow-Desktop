import type { CSSProperties } from "react";

import { IS_LINUX_RUNTIME } from "../../lib/platform";
import type { PlayerBackgroundStyle } from "../../lib/playerColors";
import { SoftBackdrop } from "../ui/SoftBackdrop";

/** `var(--player-*)` at an alpha, for gradient stops. */
const at = (role: "ground" | "base" | "accent", alpha: number) =>
  `color-mix(in srgb, var(--player-${role}) ${Math.round(alpha * 100)}%, transparent)`;

/**
 * The washes of Flow Android's `PlayerBackground`, with the same stops. They
 * read the `--player-*` colours set on the full player, so the backdrop and the
 * controls always agree, light player included.
 */
function washFor(style: PlayerBackgroundStyle): CSSProperties | null {
  switch (style) {
    case "blur":
      return { background: at("ground", 0.58) };
    case "gradient":
      return {
        background: `linear-gradient(to bottom, ${at("accent", 0.72)} 0%, ${at("base", 0.78)} 38%, ${at("ground", 0.88)} 72%, var(--player-ground) 100%)`,
      };
    case "blur_gradient":
      return {
        background: `linear-gradient(to bottom, ${at("ground", 0.4)} 0%, ${at("accent", 0.22)} 30%, ${at("base", 0.34)} 55%, ${at("ground", 0.8)} 80%, ${at("ground", 0.95)} 100%)`,
      };
    // A scrim over the photo, so the controls stay readable.
    case "immersive":
      return {
        background: `linear-gradient(to bottom, transparent 0%, ${at("ground", 0.28)} 52%, ${at("ground", 0.86)} 100%)`,
      };
    case "default":
      return null;
  }
}

// WebKitGTK would recalculate the full-window wash on the main thread for
// every frame of the ease, so Linux switches colours in one step.
const EASE = IS_LINUX_RUNTIME ? "" : "player-palette-ease";

const ARTWORK_OPACITY: Partial<Record<PlayerBackgroundStyle, string>> = {
  blur: "opacity-[0.62]",
  blur_gradient: "opacity-[0.55]",
  immersive: "opacity-[0.85]",
};

/**
 * Immersive's full-bleed cover (Android issue #954): it holds the top of the
 * player, or the start side of a wide one, then melts into its own blurred
 * continuation underneath.
 */
const IMMERSIVE_MASK = {
  top: "linear-gradient(to bottom, black 42%, transparent 85%)",
  start: "linear-gradient(to right, black 50%, transparent 100%)",
} as const;

interface AmbientBackdropProps {
  /** The cover as the artwork card loads it, so both share one cached copy. */
  imageSrc?: string | null;
  style?: PlayerBackgroundStyle;
  /** Wide layouts put the immersive cover on the start side, where the controls are not. */
  artworkAtStart?: boolean;
}

export function AmbientBackdrop({ imageSrc, style = "blur_gradient", artworkAtStart = false }: AmbientBackdropProps) {
  const artworkOpacity = ARTWORK_OPACITY[style];
  const wash = washFor(style);

  return (
    <div className={`${EASE} pointer-events-none absolute inset-0 z-0 overflow-hidden bg-[var(--player-ground)]`}>
      {artworkOpacity && imageSrc && (
        <SoftBackdrop
          src={imageSrc}
          detail={8}
          saturate
          className={`absolute inset-0 h-full w-full object-cover ${artworkOpacity}`}
        />
      )}
      {style === "immersive" && imageSrc && (
        <img
          src={imageSrc}
          alt=""
          draggable={false}
          className={`absolute inset-y-0 left-0 h-full object-cover ${artworkAtStart ? "w-[62%] object-center" : "w-full object-top"}`}
          style={{
            maskImage: IMMERSIVE_MASK[artworkAtStart ? "start" : "top"],
            WebkitMaskImage: IMMERSIVE_MASK[artworkAtStart ? "start" : "top"],
          }}
        />
      )}
      {wash && <div className={`${EASE} absolute inset-0`} style={wash} />}
    </div>
  );
}
