import { invokeBackend } from "./errors";
import { isTauriEnv } from "./env";

// --------------------------------------------------------------------------------
// SponsorBlock
// --------------------------------------------------------------------------------

export interface SponsorBlockSegment {
  category: string;
  segment: [number, number];
  UUID: string;
  /** "skip", "mute", "full" or "poi". */
  actionType?: string;
}

export async function getSponsorBlockSegments(
  videoId: string,
  serverUrl?: string,
): Promise<SponsorBlockSegment[]> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Returning mock SponsorBlock segments.");
    return [
      {
        category: "sponsor",
        segment: [10, 25],
        UUID: "mock-sponsor-uuid-1",
      },
    ];
  }
  return invokeBackend<SponsorBlockSegment[]>("get_sponsorblock_segments", {
    videoId,
    serverUrl,
  });
}

/** A part of a music video with no song playing, in seconds. A zero video length wasn't recorded. */
export interface NonMusicSegment {
  startSeconds: number;
  endSeconds: number;
  videoDurationSeconds: number;
}

/** Looked up by a hash prefix of the id, so the server can't tell which video is playing. */
export async function getNonMusicSegments(videoId: string, serverUrl?: string): Promise<NonMusicSegment[]> {
  if (!(await isTauriEnv())) return [];
  return invokeBackend<NonMusicSegment[]>("get_non_music_segments", { videoId, serverUrl });
}

export interface SubmitSponsorBlockSegmentParams {
  videoId: string;
  startTime: number;
  endTime: number;
  category: string;
  userId: string;
  serverUrl?: string;
}

export async function submitSponsorBlockSegment(
  params: SubmitSponsorBlockSegmentParams,
): Promise<void> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Skipping SponsorBlock submission.");
    return;
  }
  await invokeBackend<void>("submit_sponsorblock_segment", {
    videoId: params.videoId,
    startTime: params.startTime,
    endTime: params.endTime,
    category: params.category,
    userId: params.userId,
    serverUrl: params.serverUrl,
  });
}

// --------------------------------------------------------------------------------
// DeArrow
// --------------------------------------------------------------------------------

export interface DeArrowOverride {
  title: string | null;
  thumbnailUrl: string | null;
  /** The frame to show when nothing is submitted, for the "Use a video frame" switch. */
  randomFrameUrl: string | null;
}

/** The thumbnail to show from an override: a submission, or else a frame if that's wanted. */
export function deArrowThumbnail(override: DeArrowOverride | null, useRandomFrame: boolean): string | null {
  if (!override) return null;
  return override.thumbnailUrl ?? (useRandomFrame ? override.randomFrameUrl : null);
}

export async function getDeArrowOverride(videoId: string): Promise<DeArrowOverride | null> {
  if (!(await isTauriEnv())) return null;
  return invokeBackend<DeArrowOverride | null>("get_dearrow_override", { videoId });
}

// --------------------------------------------------------------------------------
// Return YouTube Dislike (RYD)
// --------------------------------------------------------------------------------

export interface RydData {
  id: string;
  dateCreated: string;
  likes: number;
  dislikes: number;
  rating: number;
  viewCount: number;
  deleted: boolean;
}

const YOUTUBE_VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;

export async function getReturnYouTubeDislike(videoId: string): Promise<RydData | null> {
  if (!YOUTUBE_VIDEO_ID.test(videoId)) return null;
  if (!(await isTauriEnv())) return null;

  try {
    return await invokeBackend<RydData | null>("get_return_youtube_dislike", { videoId });
  } catch (error) {
    console.warn("Failed to fetch RYD data", error);
    return null;
  }
}
