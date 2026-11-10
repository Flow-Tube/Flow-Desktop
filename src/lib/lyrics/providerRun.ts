import type { LyricsEntry } from "./types";

export type LyricsKind = "word" | "line" | "plain";

export interface LyricsAnswer {
  kind: LyricsKind;
  entries: LyricsEntry[];
  provider: string;
  source?: string | null;
}

export type LyricsReply =
  | { type: "found"; kind: LyricsKind; entries: LyricsEntry[]; source?: string | null }
  /** The source answered and has nothing for this song. */
  | { type: "miss" }
  /** The source could not answer: a network failure, a timeout or a refused request. */
  | { type: "failed" };

export interface LyricsRunResult {
  best: LyricsAnswer | null;
  everySourceMissed: boolean;
  /** At least one source really replied, so an empty result isn't just being offline. */
  someSourceReplied: boolean;
}

export const FIRST_WAVE = 2;
export const MAX_RUNNING = 3;
export const ONE_MORE_AT_MS = 2_000;
export const HOLD_MS = 800;
export const PREFERRED_WAIT_MS = 2_500;
export const STOP_AT_MS = 9_000;

export interface LyricsRunOptions {
  sources: string[];
  preferred: string;
  /** What the screen holds from the saved copy when this run looks for an upgrade. */
  alreadyShown?: LyricsKind | null;
  ask: (source: string) => Promise<LyricsReply>;
  /** False when the answer was refused, and then it does not count as shown. */
  show: (answer: LyricsAnswer) => boolean;
  signal: AbortSignal;
}

/**
 * One song's search across its lyrics sources. `preferred` and the next source start together, one
 * more joins at 2 s or as soon as a running source comes back without synced lyrics, and at most
 * three run at once. Everything stops at 9 s.
 *
 * A word-synced answer is shown at once and ends the run. A line-synced one is held for 800 ms, and
 * up to 2.5 s while `preferred` hasn't replied, so a song isn't drawn twice when a better answer
 * lands right after. The run then keeps listening for word sync. Among line-synced answers
 * `preferred` beats the rest, and otherwise the order of `sources` decides. Once one is on screen
 * only `preferred` or word sync replaces it. Plain text shows only when the run ends with nothing
 * else. Port of Android's LyricsProviderRun.
 */
export function runLyricsSources(options: LyricsRunOptions): Promise<LyricsRunResult> {
  const { sources, preferred, ask, show, signal } = options;
  return new Promise((resolve, reject) => {
    const waiting = [...sources].sort((a, b) => Number(a !== preferred) - Number(b !== preferred));
    const lines: LyricsAnswer[] = [];
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    let plain: LyricsAnswer | null = null;
    let shown: LyricsAnswer | null = null;
    let shownKind: LyricsKind | null = options.alreadyShown ?? null;
    let running = 0;
    let oneMoreDue = true;
    let holding = false;
    let holdDone = false;
    let preferredSettled = !sources.includes(preferred);
    let stopped = false;
    let anyFailed = false;
    let someSourceReplied = false;
    let over = false;

    const lineRank = (answer: LyricsAnswer) => (answer.provider === preferred ? -1 : sources.indexOf(answer.provider));
    const bestLine = () => [...lines].sort((a, b) => lineRank(a) - lineRank(b))[0]!;

    const display = (answer: LyricsAnswer) => {
      if (!show(answer)) return;
      shown = answer;
      shownKind = answer.kind;
    };

    const end = () => {
      if (over) return;
      over = true;
      timers.forEach(clearTimeout);
      signal.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      end();
      reject(signal.reason);
    };

    const isOver = () =>
      stopped || shownKind === "word" || (running === 0 && !holding && (waiting.length === 0 || !oneMoreDue));

    const finishIfOver = () => {
      if (over || !isOver()) return;
      if (shownKind !== "word") {
        if (holding) display(bestLine());
        else if (shownKind === null && plain) display(plain);
      }
      end();
      const nothingFound = lines.length === 0 && plain === null && shown === null;
      resolve({
        best: shown,
        everySourceMissed: sources.length > 0 && waiting.length === 0 && !stopped && !anyFailed && nothingFound,
        someSourceReplied,
      });
    };

    const after = (ms: number, event: () => void) => {
      timers.push(
        setTimeout(() => {
          if (over) return;
          event();
          finishIfOver();
        }, ms),
      );
    };

    const endHoldIfDue = () => {
      if (!holding || !holdDone || !preferredSettled || shownKind === "word") return;
      holding = false;
      display(bestLine());
    };

    const startNext = () => {
      if (running >= MAX_RUNNING) return;
      const source = waiting.shift();
      if (source === undefined) return;
      running++;
      ask(source).then(
        (reply) => onReply(source, reply),
        () => onReply(source, { type: "failed" }),
      );
    };

    const handleLine = (answer: LyricsAnswer) => {
      lines.push(answer);
      if (shownKind === "line") {
        if (answer.provider === preferred && shown?.provider !== preferred) display(answer);
      } else if (!holding) {
        holding = true;
        after(HOLD_MS, () => {
          holdDone = true;
          endHoldIfDue();
        });
        after(PREFERRED_WAIT_MS, () => {
          preferredSettled = true;
          endHoldIfDue();
        });
      }
    };

    const onReply = (source: string, reply: LyricsReply) => {
      if (over) return;
      running--;
      if (source === preferred) preferredSettled = true;
      if (reply.type !== "failed") someSourceReplied = true;
      if (reply.type === "found") {
        const answer: LyricsAnswer = { kind: reply.kind, entries: reply.entries, provider: source, source: reply.source };
        if (reply.kind === "word") {
          display(answer);
        } else if (reply.kind === "line") {
          handleLine(answer);
        } else {
          if (!plain || sources.indexOf(source) < sources.indexOf(plain.provider)) plain = answer;
          startNext();
        }
      } else {
        if (reply.type === "failed") anyFailed = true;
        startNext();
      }
      endHoldIfDue();
      finishIfOver();
    };

    if (signal.aborted) {
      over = true;
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    for (let i = 0; i < FIRST_WAVE; i++) startNext();
    after(ONE_MORE_AT_MS, () => {
      oneMoreDue = false;
      startNext();
    });
    after(STOP_AT_MS, () => {
      stopped = true;
    });
    finishIfOver();
  });
}
