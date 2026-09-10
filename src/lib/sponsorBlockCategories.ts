import type { SponsorBlockCategory } from "../../store/useSettingsStore";

export interface SponsorBlockCategoryMeta {
  /** Full label used in settings rows. */
  name: string;
  /** Compact label used in charts and legends. */
  short: string;
  description: string;
}

export const SB_CATEGORY_META: Record<SponsorBlockCategory, SponsorBlockCategoryMeta> = {
  sponsor: {
    name: "Sponsor",
    short: "Sponsor",
    description: "Paid promotions and product placements.",
  },
  intro: {
    name: "Intro / intermission",
    short: "Intro",
    description: "Intros, title cards, and channel branding.",
  },
  outro: {
    name: "Outro / credits",
    short: "Outro",
    description: "End cards, credits, and end-screen overlays.",
  },
  selfpromo: {
    name: "Self-promotion",
    short: "Self-promo",
    description: "Merch, Patreon, and other channels.",
  },
  interaction: {
    name: "Interaction reminder",
    short: "Interaction",
    description: "Like, subscribe, and comment reminders.",
  },
  music_offtopic: {
    name: "Non-music section",
    short: "Non-music",
    description: "Non-music parts of a music video.",
  },
  filler: {
    name: "Filler / tangent",
    short: "Filler",
    description: "Jokes and tangents not needed to follow along.",
  },
  preview: {
    name: "Preview / recap",
    short: "Preview",
    description: "Recaps and previews of the same video.",
  },
  exclusive_access: {
    name: "Exclusive access",
    short: "Exclusive",
    description: "Sponsored trips or exclusive-access segments.",
  },
};
