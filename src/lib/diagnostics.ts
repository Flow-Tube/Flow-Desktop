import { invoke } from "@tauri-apps/api/core";

/**
 * App-wide diagnostics. Keeps a small in-memory ring buffer of recent events
 * (surfaced in the player's copyable report) and forwards failures to the
 * backend so they land in the persistent rolling log — the WebView console is
 * invisible in a packaged build. Never route secrets through here.
 */

const MAX_EVENTS = 300;

export interface DiagnosticEvent {
  at: string;
  scope: string;
  message: string;
  /** Present once an identical event repeated back-to-back; `at` is the latest. */
  repeats?: number;
}

const events: DiagnosticEvent[] = [];

export function recordDiagnostic(scope: string, message: string): void {
  /*
    A fault that repeats — one handler throwing per card as the cursor sweeps a
    feed — would otherwise flush every genuinely distinct event out of the ring
    buffer, leaving the report useless exactly when something is wrong. Collapse
    a consecutive repeat into a count instead.
  */
  const last = events[events.length - 1];
  if (last && last.scope === scope && last.message === message) {
    last.repeats = (last.repeats ?? 1) + 1;
    last.at = new Date().toISOString();
    return;
  }

  events.push({ at: new Date().toISOString(), scope, message });
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
}

export function getDiagnosticEvents(): DiagnosticEvent[] {
  return events.slice();
}

/** One report line. Shared so a collapsed repeat stays visible in every report. */
export function formatDiagnosticEvent(event: DiagnosticEvent): string {
  const repeats = event.repeats && event.repeats > 1 ? ` (x${event.repeats})` : "";
  return `${event.at}  [${event.scope}] ${event.message}${repeats}`;
}

export function clearDiagnosticEvents(): void {
  events.length = 0;
}

function inTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !==
      undefined ||
      (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== undefined)
  );
}

type LogLevel = "error" | "warn" | "info";

/*
  Each forward is an IPC round trip that the backend appends to the rolling log
  file, so a repeating fault is not merely noisy — it is a per-event main-thread
  cost that makes the very jank it is reporting worse. Identical messages
  collapse to one forward per window; the tail carries the suppressed count so
  nothing is silently lost.
*/
const LOG_THROTTLE_MS = 10_000;
const MAX_THROTTLE_KEYS = 100;
const throttleState = new Map<string, { until: number; suppressed: number }>();

/** Returns the message to send, or null when this one is being suppressed. */
function throttleMessage(level: LogLevel, message: string): string | null {
  const now = Date.now();
  const key = `${level}|${message}`;
  const entry = throttleState.get(key);

  if (entry && now < entry.until) {
    entry.suppressed += 1;
    return null;
  }

  if (throttleState.size >= MAX_THROTTLE_KEYS) {
    for (const [staleKey, stale] of throttleState) {
      if (now >= stale.until) throttleState.delete(staleKey);
    }
  }

  throttleState.set(key, { until: now + LOG_THROTTLE_MS, suppressed: 0 });
  const suppressed = entry?.suppressed ?? 0;
  return suppressed > 0 ? `${message} (+${suppressed} suppressed)` : message;
}

/**
 * Best-effort forward of a frontend event to the backend log. Never throws — a
 * diagnostics path must not become a new failure source.
 */
export async function logToBackend(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
): Promise<void> {
  if (!inTauri()) return;
  const throttled = throttleMessage(level, message);
  if (throttled === null) return;
  try {
    await invoke("log_frontend_event", {
      level,
      message: throttled,
      context: context ? JSON.stringify(context) : null,
    });
  } catch {
    // Swallow: the WebView console still carries it in dev.
  }
}

let handlersInstalled = false;

/**
 * Installs process-wide handlers for otherwise-invisible failures: uncaught
 * errors and unhandled promise rejections. Both feed the ring buffer and the
 * backend log. Idempotent.
 */
export function installGlobalErrorHandlers(): void {
  if (handlersInstalled || typeof window === "undefined") return;
  handlersInstalled = true;

  window.addEventListener("error", (event) => {
    const detail = event.error?.stack ?? event.message ?? "Unknown error";
    recordDiagnostic("window.error", detail);
    void logToBackend("error", `window.error: ${event.message ?? detail}`, {
      stack: event.error?.stack,
      source: event.filename,
      line: event.lineno,
      column: event.colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as
      | { stack?: string; message?: string }
      | undefined;
    const detail = reason?.stack ?? reason?.message ?? String(event.reason ?? "unknown");
    recordDiagnostic("unhandledrejection", detail);
    void logToBackend("error", `unhandledrejection: ${detail}`, {
      stack: reason?.stack,
    });
  });
}

/**
 * Reports a fatal render error caught by the top-level ErrorBoundary.
 */
export function reportFatalError(error: Error, componentStack?: string): void {
  recordDiagnostic("react.error", `${error.name}: ${error.message}`);
  void logToBackend("error", `react.error: ${error.message}`, {
    stack: error.stack,
    componentStack,
  });
}
