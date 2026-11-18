/**
 * The code and message of a dash.js error, as scalars. The event itself holds live objects that
 * the saved player log drops, which left the cause of a fallback as `event={}`.
 */
export function dashErrorDetails(event: unknown): { code?: number; message?: string } {
  const outer = (event ?? {}) as { error?: unknown; event?: unknown; message?: unknown };
  const error = (outer.error ?? outer.event ?? event) as { code?: unknown; message?: unknown } | string | null;
  if (typeof error === "string") return { message: error.slice(0, 200) };
  const code = Number(error?.code);
  const message = error?.message ?? outer.message;
  return {
    ...(Number.isFinite(code) ? { code } : {}),
    ...(typeof message === "string" && message ? { message: message.slice(0, 200) } : {}),
  };
}
