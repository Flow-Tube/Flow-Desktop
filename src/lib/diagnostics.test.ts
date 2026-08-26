import { beforeEach, describe, expect, it } from "vitest";

import {
  clearDiagnosticEvents,
  formatDiagnosticEvent,
  getDiagnosticEvents,
  recordDiagnostic,
} from "./diagnostics";

describe("recordDiagnostic", () => {
  beforeEach(() => {
    clearDiagnosticEvents();
  });

  it("keeps distinct events as separate entries", () => {
    recordDiagnostic("window.error", "first");
    recordDiagnostic("window.error", "second");

    expect(getDiagnosticEvents().map((event) => event.message)).toEqual(["first", "second"]);
  });

  /*
    The regression this guards: one handler throwing per card as the cursor swept
    a feed pushed hundreds of identical entries, flushing every genuinely distinct
    event out of the 300-entry buffer.
  */
  it("collapses a consecutive repeat into a count instead of a new entry", () => {
    recordDiagnostic("window.error", "boom");
    recordDiagnostic("window.error", "boom");
    recordDiagnostic("window.error", "boom");

    const events = getDiagnosticEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.repeats).toBe(3);
  });

  it("does not collapse the same message reported under a different scope", () => {
    recordDiagnostic("window.error", "boom");
    recordDiagnostic("player", "boom");

    expect(getDiagnosticEvents()).toHaveLength(2);
  });

  it("starts a new entry once a different event interrupts the run", () => {
    recordDiagnostic("window.error", "boom");
    recordDiagnostic("window.error", "boom");
    recordDiagnostic("window.error", "other");
    recordDiagnostic("window.error", "boom");

    const events = getDiagnosticEvents();
    expect(events.map((event) => event.message)).toEqual(["boom", "other", "boom"]);
    expect(events[0]?.repeats).toBe(2);
    expect(events[2]?.repeats).toBeUndefined();
  });
});

describe("formatDiagnosticEvent", () => {
  it("omits the count for a single occurrence", () => {
    const line = formatDiagnosticEvent({ at: "T", scope: "player", message: "hi" });
    expect(line).toBe("T  [player] hi");
  });

  it("surfaces the count so a collapse is never silent", () => {
    const line = formatDiagnosticEvent({ at: "T", scope: "player", message: "hi", repeats: 12 });
    expect(line).toBe("T  [player] hi (x12)");
  });
});
