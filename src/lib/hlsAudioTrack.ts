import type { AudioTrack } from "../types/video";

export interface HlsAudioOption {
  name: string;
  lang?: string;
  default?: boolean;
  attrs?: Record<string, unknown>;
}

export interface HlsAudioChoice {
  name: string;
  lang?: string;
}

// Our track ids are YouTube's audio content id plus the itag: "en-US.4-140".
const contentIdOf = (track: AudioTrack) => track.id.replace(/-\d+$/, "");

const hlsContentId = (option: HlsAudioOption) => option.attrs?.["YT-EXT-AUDIO-CONTENT-ID"];

const isOriginal = (option: HlsAudioOption) => /\boriginal\s*$/i.test(option.name);

/**
 * The HLS audio track matching the one chosen in the menu. YouTube marks no track as
 * default, so hls.js alone plays whichever comes first: usually an auto-dubbed language.
 * Name and language identify the track in each audio group, so a quality change keeps it.
 */
export function hlsAudioChoice(options: HlsAudioOption[], selected: AudioTrack | null): HlsAudioChoice | null {
  const match = (selected && options.find((option) => hlsContentId(option) === contentIdOf(selected)))
    || (selected?.languageCode && options.find((option) => option.lang === selected.languageCode))
    || options.find(isOriginal)
    || options.find((option) => option.default);
  return match ? { name: match.name, lang: match.lang } : null;
}
