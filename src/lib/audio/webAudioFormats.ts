import { IS_MACOS_RUNTIME } from "../platform";

/**
 * Whether WebAudio hears an element playing `mime`. macOS WebKit plays WebM and Ogg through its
 * own player, which never feeds a MediaElementAudioSourceNode: the node gets silence while the
 * element keeps playing straight to the speakers, so filters and gains in the graph do nothing.
 */
export function webAudioHears(mime: string | null, macos = IS_MACOS_RUNTIME): boolean {
  return !macos || mime === null || !/webm|ogg|opus/i.test(mime);
}

