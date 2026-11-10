import { useEffect, useState } from "react";
import { takeLaunchProfileQuestion } from "../api/profiles";
import { useProfilesStore } from "../../store/useProfilesStore";

// The backend answers yes once, and StrictMode runs the effect twice with the first run's answer
// thrown away, so both runs read the same answer.
let takeInFlight: Promise<boolean> | null = null;

function takeOnce(): Promise<boolean> {
  takeInFlight ??= takeLaunchProfileQuestion().finally(() => {
    takeInFlight = null;
  });
  return takeInFlight;
}

/** Whether to ask who's watching: only as this process starts, and never in a way that blocks it. */
export function useLaunchProfileQuestion(): [boolean, () => void] {
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let current = true;
    void takeOnce()
      .then(async (ask) => {
        if (!ask) return;
        await useProfilesStore.getState().load();
        if (current && useProfilesStore.getState().view) setAsking(true);
      })
      .catch((error) => console.warn("Failed to read the launch profile question", error));
    return () => {
      current = false;
    };
  }, []);

  return [asking, () => setAsking(false)];
}
