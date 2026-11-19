import { describe, expect, it } from "vitest";
import { dashProxyPrefix, webkitGtkBufferSettings } from "./dashSetup";

describe("dashProxyPrefix", () => {
  it("reads the local proxy's prefix off a proxied manifest", () => {
    expect(dashProxyPrefix("http://127.0.0.1:5000/proxy?url=https%3A%2F%2Fx")).toBe("http://127.0.0.1:5000/proxy?url=");
    expect(dashProxyPrefix("blob:abc")).toBeNull();
  });
});

describe("webkitGtkBufferSettings", () => {
  it("keeps the range being played out of dash.js's pruning on Linux only", () => {
    expect(webkitGtkBufferSettings(true)).toEqual({ avoidCurrentTimeRangePruning: true });
    expect(webkitGtkBufferSettings(false)).toEqual({});
  });
});
