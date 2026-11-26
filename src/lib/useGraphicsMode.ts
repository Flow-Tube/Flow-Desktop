import { toLaunchChoice, useLaunchChoice } from './useLaunchChoice';

/** Linux startup workaround floor; see src-tauri/src/linux_startup.rs. */
export const GRAPHICS_MODES = ['automatic', 'compatible', 'safe'] as const;
export type GraphicsMode = (typeof GRAPHICS_MODES)[number];

export function toGraphicsMode(value: unknown): GraphicsMode {
  return toLaunchChoice(value, GRAPHICS_MODES, 'automatic');
}

const COMMANDS = { get: 'get_graphics_mode', set: 'set_graphics_mode', arg: 'mode' };

/** The Linux graphics compatibility mode, applied on the next launch. */
export function useGraphicsMode() {
  const { choice, setChoice, loading } = useLaunchChoice(COMMANDS, GRAPHICS_MODES, 'automatic');
  return { mode: choice, setMode: setChoice, loading };
}

/** Where WebKitGTK paints the page; see src-tauri/src/linux_nvidia.rs. */
export const PAGE_PAINTINGS = ['automatic', 'processor', 'gpu'] as const;
export type PagePainting = (typeof PAGE_PAINTINGS)[number];

const PAINTING_COMMANDS = { get: 'get_page_painting', set: 'set_page_painting', arg: 'painting' };

/** Settings' page painting choice, applied on the next launch. */
export function usePagePainting() {
  return useLaunchChoice(PAINTING_COMMANDS, PAGE_PAINTINGS, 'automatic');
}
