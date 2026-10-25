import { useScrobbleReporter } from "../../lib/useScrobbleReporter";

// Headless controller that reports music listens to the scrobbling backend.
export function ScrobbleController() {
  useScrobbleReporter();
  return null;
}
