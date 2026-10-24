const abortError = (): DOMException => new DOMException("The lyrics lookup was left", "AbortError");

interface Run<V> {
  result: Promise<V>;
  controller: AbortController;
  waiters: number;
}

/**
 * One run per key. A caller asking for a key that is already running waits for that run instead
 * of starting another; the run is aborted only once every caller waiting on it has gone.
 * Port of Android's InFlightRuns, with an AbortSignal standing in for coroutine cancellation.
 */
export class InFlightRuns<K, V> {
  private readonly runs = new Map<K, Run<V>>();

  join(key: K, block: (signal: AbortSignal) => Promise<V>, callerSignal?: AbortSignal): Promise<V> {
    if (callerSignal?.aborted) return Promise.reject(abortError());
    let run = this.runs.get(key);
    if (!run) {
      const controller = new AbortController();
      const started: Run<V> = { result: block(controller.signal), controller, waiters: 0 };
      const forget = () => {
        if (this.runs.get(key) === started) this.runs.delete(key);
      };
      started.result.then(forget, forget);
      this.runs.set(key, started);
      run = started;
    }
    const joined = run;
    joined.waiters++;

    return new Promise<V>((resolve, reject) => {
      let settled = false;
      const leave = (): boolean => {
        if (settled) return false;
        settled = true;
        callerSignal?.removeEventListener("abort", onAbort);
        joined.waiters--;
        return true;
      };
      const onAbort = () => {
        if (!leave()) return;
        if (joined.waiters === 0 && this.runs.get(key) === joined) {
          this.runs.delete(key);
          joined.controller.abort();
        }
        reject(abortError());
      };
      callerSignal?.addEventListener("abort", onAbort, { once: true });
      joined.result.then(
        (value) => {
          if (leave()) resolve(value);
        },
        (error: unknown) => {
          if (leave()) reject(error);
        },
      );
    });
  }
}

export const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";
