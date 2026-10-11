import { describe, expect, it } from "vitest";

import { getString } from "./i18n/index";
import { looksLikeAddress, syncErrorMessage } from "./syncErrors";

describe("syncErrorMessage", () => {
  it("turns each backend kind into its own actionable message", () => {
    expect(syncErrorMessage("syncExpired", "this sync code has expired")).toBe(getString("sync_error_expired"));
    expect(syncErrorMessage("syncNoPeer", null)).toBe(getString("sync_error_no_peer"));
    expect(syncErrorMessage("syncCodeRejected", "x")).toBe(getString("sync_error_code_rejected"));
  });

  it("shows the peer's own words for an error the other device reported", () => {
    expect(syncErrorMessage("syncPeerError", "disk full")).toBe(getString("sync_error_peer", "disk full"));
  });

  it("falls back to the backend text for an unknown kind", () => {
    expect(syncErrorMessage("somethingNew", "raw detail")).toBe("raw detail");
    expect(syncErrorMessage(undefined, undefined)).toBe(getString("sync_failed_body"));
  });
});

describe("looksLikeAddress", () => {
  it("recognises an address pasted instead of the connection data", () => {
    expect(looksLikeAddress("192.168.1.4:40123")).toBe(true);
    expect(looksLikeAddress(" [fd12::1]:5000 ")).toBe(true);
    expect(looksLikeAddress('{"v":1}')).toBe(false);
    expect(looksLikeAddress("123456")).toBe(false);
  });
});
