// A profile switch ends the process, and page unload events don't fire on a process exit, so
// work that otherwise saves on "beforeunload" or "pagehide" registers here too.

type Flush = () => unknown;

const flushes = new Set<Flush>();

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function onBeforeProfileSwitch(flush: Flush): () => void {
  flushes.add(flush);
  return () => {
    flushes.delete(flush);
  };
}

/** Stops playback in this window and saves what it would save on unload. */
export async function runBeforeProfileSwitch(): Promise<void> {
  for (const media of document.querySelectorAll<HTMLMediaElement>("video, audio")) media.pause();
  const pending = [...flushes].map((flush) => {
    try {
      return Promise.resolve(flush());
    } catch (error) {
      return Promise.reject(error);
    }
  });
  await Promise.race([Promise.allSettled(pending), delay(2500)]);
  // Some saves are sent without a promise to wait on; give their calls a moment to land.
  await delay(300);
}
