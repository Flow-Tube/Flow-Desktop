import { invoke } from "@tauri-apps/api/core";

export interface BackendErrorResponse {
  message: string;
  kind: string;
  /** When an upcoming premiere or stream starts, in epoch milliseconds. */
  startsAtMs?: number;
}

export class BackendApiError extends Error {
  readonly kind: string;
  readonly causeValue: unknown;
  readonly startsAtMs?: number;

  constructor(message: string, kind: string, causeValue: unknown, startsAtMs?: number) {
    super(message);
    this.name = "BackendApiError";
    this.kind = kind;
    this.causeValue = causeValue;
    this.startsAtMs = startsAtMs;
  }
}

function isBackendErrorResponse(value: unknown): value is BackendErrorResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.message === "string" && typeof candidate.kind === "string";
}

export function normalizeBackendError(error: unknown): BackendApiError {
  if (isBackendErrorResponse(error)) {
    return new BackendApiError(error.message, error.kind, error, error.startsAtMs);
  }

  if (typeof error === "string") {
    try {
      const parsed = JSON.parse(error) as unknown;
      if (isBackendErrorResponse(parsed)) {
        return new BackendApiError(parsed.message, parsed.kind, error, parsed.startsAtMs);
      }
    } catch {
      // Fall through to the generic string case.
    }

    return new BackendApiError(error, "unknown", error);
  }

  if (error instanceof Error) {
    return new BackendApiError(error.message, "unknown", error);
  }

  return new BackendApiError("Unknown backend API error", "unknown", error);
}

export function getBackendErrorMessage(error: unknown): string {
  return normalizeBackendError(error).message;
}

export async function invokeBackend<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw normalizeBackendError(error);
  }
}