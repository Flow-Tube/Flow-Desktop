export type OnboardingStep = "interests" | "channels" | "artists" | "alerts" | "import" | "ready";

/** The setup steps in order. A new profile that copied subscriptions has nothing to import. */
export function onboardingSteps(hasSubscriptions: boolean): OnboardingStep[] {
  return [
    "interests",
    "channels",
    "artists",
    "alerts",
    ...(hasSubscriptions ? [] : (["import"] as const)),
    "ready",
  ];
}

/** Ready ends the steps the bar counts: share done, or null when it is hidden. */
export function onboardingProgress(steps: OnboardingStep[], step: OnboardingStep): number | null {
  const counted: OnboardingStep[] = steps.filter((item) => item !== "ready");
  const index = counted.indexOf(step);
  return index < 0 ? null : ((index + 1) / counted.length) * 100;
}
