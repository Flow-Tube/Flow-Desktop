import { useWellbeingReminders } from "../../lib/wellbeing/useWellbeingReminders";

/** Mounted once, in the main window. */
export function WellbeingController() {
  useWellbeingReminders();
  return null;
}
