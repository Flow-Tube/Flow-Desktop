import { useMusicTray } from "../../lib/useMusicTray";

// Headless controller that keeps the system tray in step with the music player.
export function MusicTrayController() {
  useMusicTray();
  return null;
}
