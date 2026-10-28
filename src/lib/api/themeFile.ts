import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invokeBackend } from "./errors";

export type ThemeFileStatus = "missing" | "loaded" | "tooLarge" | "notText" | "unreadable";

/** The user's `custom.css`, as the backend last read it. Mirrors `services::theme_file::ThemeFileState`. */
export interface ThemeFileState {
  path: string;
  status: ThemeFileStatus;
  /** The file's text, only when `status` is `loaded`. */
  css: string | null;
}

/** Must match `commands::theme::THEME_FILE_CHANGED_EVENT`. */
const THEME_FILE_CHANGED_EVENT = "theme-file://changed";

export function getThemeFileState(): Promise<ThemeFileState> {
  return invokeBackend<ThemeFileState>("theme_file_state");
}

/** Writes the commented starter file, unless the user already has one. */
export function createThemeFile(): Promise<ThemeFileState> {
  return invokeBackend<ThemeFileState>("create_theme_file");
}

export function revealThemeFile(): Promise<void> {
  return invokeBackend<void>("reveal_theme_file");
}

/** While on, the backend sends the file's new state each time it changes on disk. */
export function watchThemeFile(enabled: boolean): Promise<void> {
  return invokeBackend<void>("watch_theme_file", { enabled });
}

export function onThemeFileChanged(handler: (state: ThemeFileState) => void): Promise<UnlistenFn> {
  return listen<ThemeFileState>(THEME_FILE_CHANGED_EVENT, (event) => handler(event.payload));
}
