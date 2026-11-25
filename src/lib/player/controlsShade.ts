/** How dark the shade behind the player controls is (#719). */
export type ControlsShade = "standard" | "light" | "off";

export const CONTROLS_SHADES: readonly ControlsShade[] = ["standard", "light", "off"];

export function controlsShade(value: string | undefined): ControlsShade {
  return CONTROLS_SHADES.find((shade) => shade === value) ?? "standard";
}

export interface ControlsShadeClasses {
  /** Gradient stops for the band behind the controls, or null for no band. */
  scrim: string | null;
  /** Backing for the time, volume, chapter and button pills. */
  pill: string;
  /** Backing for buttons that sit straight on the video, which only need one when there is no band. */
  bare: string | null;
  /** Backing for the fullscreen title, the one line of text with nothing behind it. */
  title: string | null;
  /** The unplayed part of the seek bar. */
  track: string;
}

const CLASSES: Record<ControlsShade, ControlsShadeClasses> = {
  standard: {
    scrim: "from-chrome-black/70 via-chrome-black/25",
    pill: "bg-chrome-black/35",
    bare: null,
    title: null,
    track: "bg-chrome-white/25",
  },
  light: {
    scrim: "from-chrome-black/45 via-chrome-black/15",
    pill: "bg-chrome-black/45",
    bare: null,
    title: "bg-chrome-black/30",
    track: "bg-chrome-white/25",
  },
  // Without the band the backings carry the contrast alone, so a white title or icon stays readable on
  // snow, and the track gets a dark edge that a bright frame can't wash out.
  off: {
    scrim: null,
    pill: "bg-chrome-black/55",
    bare: "bg-chrome-black/55",
    title: "bg-chrome-black/55",
    track: "bg-chrome-white/25 ring-1 ring-inset ring-chrome-black/30",
  },
};

export function controlsShadeClasses(shade: ControlsShade): ControlsShadeClasses {
  return CLASSES[shade];
}
