let detectedTauri: boolean | null = null;

/**
 * Asynchronously detects if the frontend is running inside the Tauri shell environment.
 * Waits up to 100ms to allow Tauri's IPC bridge to be injected, avoiding hydration race conditions.
 */
export async function isTauriEnv(): Promise<boolean> {
  if (detectedTauri !== null) {
    return detectedTauri;
  }

  if (typeof window === "undefined") {
    detectedTauri = false;
    return false;
  }

  // Poll for up to 100ms for Tauri internals injection
  for (let i = 0; i < 10; i++) {
    // The page can be gone by the next tick, such as a test environment torn down mid-poll.
    if (typeof window === "undefined") break;
    if (
      (window as any).__TAURI_INTERNALS__ !== undefined ||
      (window as any).__TAURI__ !== undefined
    ) {
      detectedTauri = true;
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  detectedTauri = false;
  return false;
}
