import type { CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";

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

/** Where immersive's cover sits: across the top, on the start side, or behind a centred song. */
type ImmersiveArtworkPlacement = "top" | "start" | "center";

/**
 * Immersive's full-bleed cover (Android issue #954): it holds the top of the
 * player, the start side of a wide one beside Up next or the lyrics, or the
 * middle of a wide one with the side pane hidden, then melts into its own
 * blurred continuation underneath.
 */
const IMMERSIVE_COVER: Record<ImmersiveArtworkPlacement, { className: string; mask: string }> = {
  top: { className: "left-0 w-full object-top", mask: "linear-gradient(to bottom, black 42%, transparent 85%)" },
  start: { className: "left-0 w-[62%] object-center", mask: "linear-gradient(to right, black 50%, transparent 100%)" },
  center: {
    className: "left-[19%] w-[62%] object-center",
    mask: "radial-gradient(ellipse 50% 50% at 50% 50%, black 45%, transparent 100%)",
  },
};

interface AmbientBackdropProps {
  /** The cover as the artwork card loads it, so both share one cached copy. */
  imageSrc?: string | null;
  style?: PlayerBackgroundStyle;
  /** Wide layouts put the immersive cover beside the side pane, or behind the song when it is hidden. */
  artworkPlacement?: ImmersiveArtworkPlacement;
}

export function AmbientBackdrop({ imageSrc, style = "blur_gradient", artworkPlacement = "top" }: AmbientBackdropProps) {
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
      {/* The cover crossfades to its new place as the side pane opens or closes. */}
      <AnimatePresence initial={false}>
        {style === "immersive" && imageSrc && (
          <motion.img
            key={artworkPlacement}
            src={imageSrc}
            alt=""
            draggable={false}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className={`absolute inset-y-0 h-full object-cover ${IMMERSIVE_COVER[artworkPlacement].className}`}
            style={{
              maskImage: IMMERSIVE_COVER[artworkPlacement].mask,
              WebkitMaskImage: IMMERSIVE_COVER[artworkPlacement].mask,
            }}
          />
        )}
      </AnimatePresence>
      {wash && <div className={`${EASE} absolute inset-0`} style={wash} />}
    </div>
  );
}
