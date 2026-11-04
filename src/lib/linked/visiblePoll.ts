/** Calls `load` now and every `intervalMs` while the window is visible, and again when it shows.
 * Returns the stop function. */
export function pollWhileVisible(load: () => void, intervalMs: number): () => void {
  let timer: number | undefined;
  const update = () => {
    window.clearInterval(timer);
    timer = undefined;
    if (document.visibilityState === "hidden") return;
    load();
    timer = window.setInterval(load, intervalMs);
  };
  update();
  document.addEventListener("visibilitychange", update);
  return () => {
    document.removeEventListener("visibilitychange", update);
    window.clearInterval(timer);
  };
}
