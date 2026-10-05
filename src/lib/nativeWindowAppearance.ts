import { invokeBackend } from "./api/errors";

export function setNativeWindowBackground(color: string): Promise<void> {
  // Tauri 2.11's JS setter sends `color`, but its Rust handler accepts `value`.
  return invokeBackend<void>("set_window_background", { color });
}
