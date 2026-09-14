import { useDiscordPresence } from "../../lib/useDiscordPresence";

// Headless controller that drives Discord Rich Presence.
export function DiscordPresenceController() {
  useDiscordPresence();
  return null;
}
