export const MINI_PLAYER_SIZES = ["small", "medium", "large"] as const;
export type MiniPlayerSize = (typeof MINI_PLAYER_SIZES)[number];

const WIDTH_PX: Record<MiniPlayerSize, number> = { small: 320, medium: 420, large: 560 };

export const miniPlayerWidthPx = (size: string | undefined): number =>
  WIDTH_PX[(size as MiniPlayerSize) ?? "medium"] ?? WIDTH_PX.medium;
