import { usePipController } from "../../lib/usePipController";

/** Headless: keeps the main window in step with the pop-out player window. */
export function PipWindowController() {
  usePipController();
  return null;
}
