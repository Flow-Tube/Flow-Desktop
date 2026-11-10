import { getString } from "../i18n/index";
import { BackendApiError } from "../api/errors";

export const LOCAL_FORMAT_UNSUPPORTED = "localFormatUnsupported";
const LOCAL_AUDIO_UNSUPPORTED = "localAudioUnsupported";
const LOCAL_VIDEO_UNSUPPORTED = "localVideoUnsupported";

// Each codec is asked about in a container it is known to travel in. A file's own container isn't
// what decides: Chromium reads Matroska under the WebM label whatever the label promises.
const AUDIO_PROBES: Record<string, string> = {
  aac: 'audio/mp4; codecs="mp4a.40.2"',
  mp3: "audio/mpeg",
  opus: 'audio/webm; codecs="opus"',
  vorbis: 'audio/webm; codecs="vorbis"',
  flac: "audio/flac",
  alac: 'audio/mp4; codecs="alac"',
  ac3: 'audio/mp4; codecs="ac-3"',
  eac3: 'audio/mp4; codecs="ec-3"',
  dts: 'audio/mp4; codecs="dtsc"',
  truehd: 'audio/mp4; codecs="mlpa"',
  pcm: 'audio/wav; codecs="1"',
  wma: "audio/x-ms-wma",
  ape: "audio/ape",
  wavpack: "audio/x-wavpack",
};

const VIDEO_PROBES: Record<string, string> = {
  h264: 'video/mp4; codecs="avc1.42E01E"',
  hevc: 'video/mp4; codecs="hvc1.1.6.L93.B0"',
  av1: 'video/mp4; codecs="av01.0.01M.08"',
  vp9: 'video/webm; codecs="vp9"',
  vp8: 'video/webm; codecs="vp8"',
  mpeg4: 'video/mp4; codecs="mp4v.20.8"',
  prores: 'video/quicktime; codecs="apch"',
};

const webviewCanPlay = (mime: string) => document.createElement("video").canPlayType(mime) !== "";

/**
 * Why a file can't play here, known before trying. A video with a sound format the webview can't
 * decode plays silent with no error at all, so this is the only place that can catch it. A codec
 * nobody listed gets to try: the media element's own error covers a wrong guess.
 */
export function localPlaybackError(
  stream: { videoCodec: string; audioCodec: string },
  canPlay: (mime: string) => boolean = webviewCanPlay,
): BackendApiError | null {
  const audioProbe = AUDIO_PROBES[stream.audioCodec];
  if (audioProbe && !canPlay(audioProbe)) {
    const message = getString("player_error_local_audio_detail", stream.audioCodec);
    return new BackendApiError(message, LOCAL_AUDIO_UNSUPPORTED, null);
  }
  const videoProbe = VIDEO_PROBES[stream.videoCodec];
  if (videoProbe && !canPlay(videoProbe)) {
    const message = getString("player_error_local_video_detail", stream.videoCodec);
    return new BackendApiError(message, LOCAL_VIDEO_UNSUPPORTED, null);
  }
  return null;
}
