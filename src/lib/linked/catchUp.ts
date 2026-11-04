import { catchUpLinkedProfile } from "../api/linked";

const LIMIT_MS = 30_000;

let caughtUp: Promise<void> | null = null;

/** Settles when `work` does, or after `limitMs`, whichever is first; a failure only ends the wait. */
export function settleWithin(work: Promise<unknown>, limitMs: number): Promise<void> {
  return Promise.race([
    work.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => setTimeout(resolve, limitMs)),
  ]);
}

/** Waits, once per launch, for a linked profile to apply what other devices sent, so a profile
 * added from another device doesn't open as a new one. */
export function catchUpOnce(): Promise<void> {
  caughtUp ??= settleWithin(catchUpLinkedProfile(), LIMIT_MS);
  return caughtUp;
}
