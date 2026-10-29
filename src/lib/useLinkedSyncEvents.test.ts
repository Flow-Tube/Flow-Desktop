import { describe, expect, it } from "vitest";

import { receivedMessage } from "./useLinkedSyncEvents";

describe("receivedMessage", () => {
  it("names the device and counts the changes", () => {
    expect(receivedMessage({ name: "Pixel", count: 1 })).toBe("Received 1 change from Pixel");
    expect(receivedMessage({ name: "Pixel", count: 12 })).toBe("Received 12 changes from Pixel");
    expect(receivedMessage({ name: " ", count: 3 })).toBe("Received 3 changes from another device");
  });
});
