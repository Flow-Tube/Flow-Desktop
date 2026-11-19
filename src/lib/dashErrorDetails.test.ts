import { describe, expect, it } from "vitest";
import { dashErrorDetails } from "./dashErrorDetails";

describe("dashErrorDetails", () => {
  it("reads the code and message of a dash.js error event", () => {
    const request: Record<string, unknown> = { url: "http://127.0.0.1/seg" };
    request.self = request;
    const event = { type: "error", error: { code: 27, message: "Failed loading fragment", data: { request } } };
    expect(dashErrorDetails(event)).toEqual({ code: 27, message: "Failed loading fragment" });
    // What the log keeps has to survive being written out.
    expect(() => JSON.stringify(dashErrorDetails(event))).not.toThrow();
  });

  it("reads a playback error, which arrives under another name", () => {
    expect(dashErrorDetails({ event: { code: 3, message: "MEDIA_ERR_DECODE" } })).toEqual({ code: 3, message: "MEDIA_ERR_DECODE" });
  });

  it("keeps a bare message and leaves out what is missing", () => {
    expect(dashErrorDetails({ error: "segmentbase failed" })).toEqual({ message: "segmentbase failed" });
    expect(dashErrorDetails({ message: "manifest broken" })).toEqual({ message: "manifest broken" });
    expect(dashErrorDetails(null)).toEqual({});
  });

  it("cuts a long message", () => {
    expect(dashErrorDetails({ error: { message: "x".repeat(500) } }).message).toHaveLength(200);
  });
});
