import { pickAutoVideoTrack, type DashVideoTrack } from "./dashVideoTrack";
import { profileStorage } from "./storage/profileStorage";
import type { StreamVariant } from "../types/video";

// What dash.js starts at when it is told nothing.
const DASH_DEFAULT_START_KBPS = 1000;
// dash.js shows no picture until the whole first segment has arrived. At this
// margin a 5 s segment takes about 2 s, the longest a start quality may hold it up.
const START_SPEED_MARGIN = 2.5;

const MEASURED_SPEED_KEY = "dash_measured_speed_kbps";
// A small segment's time is mostly latency, which would read as a slow connection.
const MIN_SAMPLE_BYTES = 256 * 1024;
const SAMPLE_WEIGHT = 0.3;

export interface DashStart {
  bitrateKbps: number | null;
  setId: string | null;
}

interface ManifestRepresentation {
  id?: unknown;
  bandwidth?: number;
  width?: number;
  height?: number;
  codecs?: string;
}

interface ManifestAdaptationSet {
  id?: unknown;
  contentType?: string;
  mimeType?: string;
  Representation?: ManifestRepresentation[];
}

/** The video sets of a parsed manifest, in the shape dash.js gives its own tracks. */
export function manifestVideoTracks(manifest: unknown): DashVideoTrack[] {
  const period = (manifest as { Period?: Array<{ AdaptationSet?: ManifestAdaptationSet[] }> } | null)?.Period?.[0];
  return (period?.AdaptationSet ?? [])
    .filter((set) => set.contentType === "video" && set.id != null)
    .map((set) => {
      const representations = set.Representation ?? [];
      const mimeType = set.mimeType ?? "video/mp4";
      return {
        id: String(set.id),
        mimeType,
        codec: `${mimeType};codecs="${representations[0]?.codecs ?? ""}"`,
        bitrateList: representations.map((representation) => ({
          id: String(representation.id),
          width: representation.width,
          height: representation.height,
          bandwidth: representation.bandwidth,
        })),
      };
    });
}

/**
 * Where playback should begin, decided before dash.js picks. `selected` is null on
 * Auto. A quality the connection can't load quickly starts at dash.js's own low
 * bitrate and follows from the next segment, so a slow link still shows a picture soon.
 */
export function pickDashStart(input: {
  selected: StreamVariant | null;
  tracks: DashVideoTrack[];
  preferredCodec: string;
  speedKbps: number | null;
}): DashStart {
  const { selected, tracks, preferredCodec, speedKbps } = input;

  if (!selected) {
    return {
      bitrateKbps: speedKbps === null ? null : Math.floor(speedKbps / START_SPEED_MARGIN),
      setId: pickAutoVideoTrack(tracks, preferredCodec)?.id ?? null,
    };
  }

  const track = tracks.find((candidate) => candidate.bitrateList?.some((item) => item.id === selected.id));
  const bandwidth = track?.bitrateList?.find((item) => item.id === selected.id)?.bandwidth;
  if (!track?.id || !bandwidth) return { bitrateKbps: null, setId: null };

  const kbps = Math.ceil(bandwidth / 1000);
  const loadsQuickly = speedKbps === null || speedKbps >= kbps * START_SPEED_MARGIN;
  // A slow start still stays in the chosen codec: hopping from H.264 to AV1 mid-video
  // has failed to decode on bytes that play fine when the video starts on AV1.
  return { bitrateKbps: loadsQuickly || kbps <= DASH_DEFAULT_START_KBPS ? kbps : null, setId: track.id };
}

export function readMeasuredSpeedKbps(): number | null {
  try {
    const value = Number(profileStorage.getItem(MEASURED_SPEED_KEY, "device"));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

interface FragmentLoadedEvent {
  error?: unknown;
  mediaType?: string;
  request?: {
    type?: string;
    bytesLoaded?: number;
    startDate?: Date | string | null;
    endDate?: Date | string | null;
  };
}

/**
 * Times the download itself. dash.js's getAverageThroughput read 16-34 Mbps on a
 * 5 Mbps link in testing, so it can't decide what a connection will carry.
 */
export function recordVideoSegmentSpeed(event: unknown): void {
  const { error, mediaType, request } = (event ?? {}) as FragmentLoadedEvent;
  if (error || mediaType !== "video" || request?.type !== "MediaSegment") return;
  if (!request.startDate || !request.endDate || (request.bytesLoaded ?? 0) < MIN_SAMPLE_BYTES) return;

  const elapsedMs = new Date(request.endDate).getTime() - new Date(request.startDate).getTime();
  if (!(elapsedMs > 0)) return;

  const sampleKbps = ((request.bytesLoaded ?? 0) * 8) / elapsedMs;
  const previous = readMeasuredSpeedKbps();
  const next = previous === null ? sampleKbps : previous + (sampleKbps - previous) * SAMPLE_WEIGHT;
  try {
    profileStorage.setItem(MEASURED_SPEED_KEY, String(Math.round(next)), "device");
  } catch {
    // Without storage the next video just starts as if nothing had been measured.
  }
}
