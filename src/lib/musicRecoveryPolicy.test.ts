import { describe, expect, it } from "vitest";

import {
  MAX_RECOVERIES_PER_TRACK,
  MEDIA_FAILURE_KIND,
  RECOVERY_SUCCESS_GRACE_MS,
  RecoveryLedger,
  classifyMediaFailure,
} from "./musicRecoveryPolicy";

describe("classifyMediaFailure", () => {
  it("reads the element's error code, and offline before anything else", () => {
    expect(classifyMediaFailure(2, false)).toBe("offline");
    expect(classifyMediaFailure(3, true)).toBe("decode");
    expect(classifyMediaFailure(4, true)).toBe("decode");
    expect(classifyMediaFailure(2, true)).toBe("link");
    expect(classifyMediaFailure(1, true)).toBe("link");
    expect(classifyMediaFailure(null, true)).toBe("link");
  });

  it("names each failure with its own error kind", () => {
    expect(new Set(Object.values(MEDIA_FAILURE_KIND)).size).toBe(3);
  });
});

describe("RecoveryLedger", () => {
  it("allows a few fresh links per track, then gives up", () => {
    const ledger = new RecoveryLedger();
    for (let i = 0; i < MAX_RECOVERIES_PER_TRACK; i++) expect(ledger.decide("a", "link", i)).toBe("retry");
    expect(ledger.decide("a", "link", 10)).toBe("giveUp");
    expect(ledger.decide("b", "link", 10)).toBe("retry");
  });

  it("forgives the count after two minutes of clean playback, like Android", () => {
    const ledger = new RecoveryLedger();
    for (let i = 0; i < MAX_RECOVERIES_PER_TRACK; i++) ledger.decide("a", "link", 0);
    ledger.notePlaying("a", RECOVERY_SUCCESS_GRACE_MS - 1);
    expect(ledger.decide("a", "link", RECOVERY_SUCCESS_GRACE_MS)).toBe("giveUp");

    const fresh = new RecoveryLedger();
    for (let i = 0; i < MAX_RECOVERIES_PER_TRACK; i++) fresh.decide("a", "link", 0);
    fresh.notePlaying("a", RECOVERY_SUCCESS_GRACE_MS + 1);
    expect(fresh.decide("a", "link", RECOVERY_SUCCESS_GRACE_MS + 2)).toBe("retry");
  });

  it("waits out a lost connection without spending an attempt", () => {
    const ledger = new RecoveryLedger();
    for (let i = 0; i < 10; i++) expect(ledger.decide("a", "offline", i)).toBe("waitForNetwork");
    expect(ledger.decide("a", "link", 11)).toBe("retry");
  });

  it("switches to AAC once, and gives up when AAC never played", () => {
    const ledger = new RecoveryLedger();
    expect(ledger.prefersAac("a")).toBe(false);
    expect(ledger.decide("a", "decode", 0)).toBe("retry");
    expect(ledger.prefersAac("a")).toBe(true);
    expect(ledger.decide("a", "decode", 1)).toBe("giveUp");
  });

  it("treats a later failure of AAC that did play as a dead link", () => {
    const ledger = new RecoveryLedger();
    ledger.decide("a", "decode", 0);
    ledger.notePlaying("a", 1);
    expect(ledger.decide("a", "decode", 2)).toBe("retry");
  });

  it("starts the count again when the user retries", () => {
    const ledger = new RecoveryLedger();
    for (let i = 0; i < MAX_RECOVERIES_PER_TRACK; i++) ledger.decide("a", "link", 0);
    ledger.forgive("a");
    expect(ledger.decide("a", "link", 1)).toBe("retry");
  });
});
