import { describe, expect, it } from "vitest";
import { dashProxyPrefix } from "./dashSetup";

describe("dashProxyPrefix", () => {
  it("reads the local proxy's prefix off a proxied manifest", () => {
    expect(dashProxyPrefix("http://127.0.0.1:5000/proxy?url=https%3A%2F%2Fx")).toBe("http://127.0.0.1:5000/proxy?url=");
    expect(dashProxyPrefix("blob:abc")).toBeNull();
  });
});
