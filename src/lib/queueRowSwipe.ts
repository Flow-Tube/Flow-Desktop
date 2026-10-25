/** What a swipe on an Up next row does, as Flow for Android stores it. */
export type QueueSwipeAction = "PLAY_NEXT" | "MOVE_TO_END" | "REMOVE";

export const QUEUE_SWIPE_ACTIONS: readonly QueueSwipeAction[] = ["PLAY_NEXT", "MOVE_TO_END", "REMOVE"];

/** Android's defaults: left plays next, right removes. */
export const DEFAULT_LEFT_SWIPE: QueueSwipeAction = "PLAY_NEXT";
export const DEFAULT_RIGHT_SWIPE: QueueSwipeAction = "REMOVE";

// Android's QueueRowSwipeGestureHandler: the first 60 dp of travel show as 20, then the row
// breaks free and follows; past 40 % of the row's width a release commits.
const TENSION_TRAVEL_PX = 60;
const TENSION_VISUAL_PX = 20;
const COMMIT_FRACTION = 0.4;

export const parseQueueSwipeAction = (value: string | null | undefined, fallback: QueueSwipeAction): QueueSwipeAction =>
  QUEUE_SWIPE_ACTIONS.find((action) => action === value) ?? fallback;

/** Whether `travel` is still inside the tension zone. */
export const inTension = (travel: number): boolean => Math.abs(travel) < TENSION_TRAVEL_PX;

/** Where the row sits for `travel` while it is held back by the tension zone. */
export const tensionOffset = (travel: number): number =>
  Math.sign(travel) * TENSION_VISUAL_PX * Math.min(1, Math.abs(travel) / TENSION_TRAVEL_PX);

export const inCommitZone = (travel: number, width: number): boolean =>
  width > 0 && Math.abs(travel) > width * COMMIT_FRACTION;

/** The action for a swipe that travelled `travel` (negative is towards the left). */
export const swipeActionFor = (travel: number, left: QueueSwipeAction, right: QueueSwipeAction): QueueSwipeAction =>
  travel < 0 ? left : right;

/** A removed row leaves the list, so it flies off instead of swinging back. */
export const leavesList = (action: QueueSwipeAction): boolean => action === "REMOVE";
