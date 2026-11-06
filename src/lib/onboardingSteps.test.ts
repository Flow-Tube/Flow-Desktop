import { describe, expect, it } from "vitest";
import { onboardingProgress, onboardingSteps } from "./onboardingSteps";

describe("onboarding steps", () => {
  it("runs from Interests to Ready, with Artists and Alerts between", () => {
    expect(onboardingSteps(false)).toEqual(["interests", "channels", "artists", "alerts", "import", "ready"]);
  });

  it("skips Import for a profile that copied subscriptions", () => {
    expect(onboardingSteps(true)).not.toContain("import");
  });

  it("counts only the steps between the bookends", () => {
    const steps = onboardingSteps(false);
    expect(onboardingProgress(steps, "ready")).toBeNull();
    expect(onboardingProgress(steps, "interests")).toBe(20);
    expect(onboardingProgress(steps, "import")).toBe(100);
  });
});
