import { describe, expect, it } from "vitest";

import { mutePauseAction } from "./musicMutePause";

describe("mutePauseAction", () => {
  it("pauses playing music when muted, only with the setting on", () => {
    expect(mutePauseAction(true, true, true, false)).toBe("pause");
    expect(mutePauseAction(true, false, true, false)).toBe("none");
    expect(mutePauseAction(true, true, false, false)).toBe("none");
  });

  it("resumes only what it paused", () => {
    expect(mutePauseAction(false, true, false, true)).toBe("resume");
    expect(mutePauseAction(false, true, false, false)).toBe("none");
    expect(mutePauseAction(true, true, false, true)).toBe("none");
  });
});
