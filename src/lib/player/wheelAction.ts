/** What a plain wheel or two-finger scroll does over the video. */
export type PlayerWheelAction = "scroll" | "volume" | "zoom";

export const PLAYER_WHEEL_ACTIONS: readonly PlayerWheelAction[] = ["scroll", "volume", "zoom"];

/** The page scrolls by default: the watch page sits under the player, and the comments are below it. */
export function playerWheelAction(value: string | undefined): PlayerWheelAction {
  return PLAYER_WHEEL_ACTIONS.find((action) => action === value) ?? "scroll";
}

/**
 * Ctrl or Cmd and the wheel over the video zoom, unless the plain wheel already zooms: then they
 * change the volume, so one wheel reaches both.
 */
export function ctrlWheelAction(action: PlayerWheelAction): "zoom" | "volume" {
  return action === "zoom" ? "volume" : "zoom";
}
