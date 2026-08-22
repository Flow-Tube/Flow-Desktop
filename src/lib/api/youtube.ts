import type {
  SearchVideosRequest,
  SearchVideosResponse,
  VideoDetails,
  StreamInfo,
  ChannelDetails,
  ChannelTabResponse,
  ChannelItem,
  PlaylistDetailsResponse,
  CommentsResponse,
  LiveChatResponse,
  VideoSummary,
  RelatedContentItem,
  PlaylistSummary,
} from "../../types/video";
import { isTauriEnv } from "./env";
import {
  BackendApiError,
  getBackendErrorMessage,
  invokeBackend,
} from "./errors";

export { BackendApiError as YoutubeApiError };

export type TrendingCategory = "all" | "trending" | "gaming" | "music" | "movies" | "live";

export function getYoutubeErrorMessage(error: unknown): string {
  return getBackendErrorMessage(error);
}

export async function searchVideos(
  request: SearchVideosRequest,
): Promise<SearchVideosResponse> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Returning curated mock video results.");
    return {
      items: [
        {
          id: "dQw4w9WgXcQ",
          title: "Building an Offline Recommendation Engine with Rust & SQLite",
          channelName: "Fireship",
          thumbnailUrl: "https://images.unsplash.com/photo-1607799279861-4dd421887fb3?q=80&w=300",
          durationSeconds: 156,
          publishedText: "3 days ago",
          viewCountText: "235K views",
        },
        {
          id: "3s7h2tqD9oI",
          title: "Astrophysics Masterclass: Understanding the Quantum Field",
          channelName: "Veritasium",
          thumbnailUrl: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=300",
          durationSeconds: 980,
          publishedText: "1 week ago",
          viewCountText: "1.2M views",
        },
        {
          id: "9T8y3H1xQ4s",
          title: "Cosmic Lo-Fi Session: Music to Code/Relax/Study",
          channelName: "Lofi Girl",
          thumbnailUrl: "https://images.unsplash.com/photo-1518495973542-4542c06a5843?q=80&w=300",
          durationSeconds: 18000,
          publishedText: "Live Now",
          viewCountText: "45K watching",
        },
        {
          id: "6H7J8K9L0M",
          title: "Why Memory Safety in Rust Actually Matters",
          channelName: "The Primeagen",
          thumbnailUrl: "https://images.unsplash.com/photo-1629654297299-c8506221ca97?q=80&w=300",
          durationSeconds: 720,
          publishedText: "2 days ago",
          viewCountText: "98K views",
        },
      ],
      nextPageToken: "mock-token",
      source: "mock-extractor",
    };
  }
  return invokeBackend<SearchVideosResponse>("search_videos", { request });
}

export async function getVideoDetails(videoId: string): Promise<VideoDetails> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Returning mock video details.");
    return {
      id: videoId,
      title: "Building an Offline Recommendation Engine with Rust & SQLite",
      channelName: "Fireship",
      description: "A deep dive into local telemetry recommendation matrices.",
      thumbnailUrl: "https://images.unsplash.com/photo-1607799279861-4dd421887fb3?q=80&w=300",
      durationSeconds: 156,
    };
  }
  return invokeBackend<VideoDetails>("get_video_details", { videoId });
}

export async function getRelatedVideos(videoId: string): Promise<RelatedContentItem[]> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Returning mock related content.");
    return [
      {
        id: "dQw4w9WgXcQ",
        itemType: "video",
        title: "Mock Related Video",
        channelName: "Mock Creator",
        thumbnailUrl: "https://images.unsplash.com/photo-1607799279861-4dd421887fb3?q=80&w=300",
        durationSeconds: 180,
        publishedText: "3 months ago",
        viewCountText: "2M views",
        videoId: "dQw4w9WgXcQ",
        playlistId: null,
        isMix: false,
      },
      {
        id: "RDAMVMdQw4w9WgXcQ",
        itemType: "mix",
        title: "Mock Coding Mix",
        channelName: "YouTube Mix",
        thumbnailUrl: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=300",
        viewCountText: "Mix",
        videoId: "dQw4w9WgXcQ",
        playlistId: "RDAMVMdQw4w9WgXcQ",
        isMix: true,
      },
    ];
  }
  return invokeBackend<RelatedContentItem[]>("get_related_videos", { videoId });
}

export async function getStreamInfo(videoId: string, refresh = false): Promise<StreamInfo> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Returning public fallback stream link.");
    return {
      streamId: videoId,
      localUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
      expiresAt: "never",
      variants: [
        {
          id: "mock-720p",
          localUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
          qualityLabel: "720p",
          mimeType: "video/mp4",
          width: 1280,
          height: 720,
          fps: 30,
          bitrate: null,
          isDefault: true,
          isPlayable: true,
          hasAudio: true,
          isVideoOnly: false,
          deliveryMethod: "progressive",
        },
      ],
      captions: [],
      audioTracks: [
        {
          id: "mock-audio",
          label: "Original audio",
          languageCode: "en",
          audioTrackType: "default",
          localUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
          mimeType: "audio/mp4",
          bitrate: null,
          isDefault: true,
          available: true,
        },
      ],
      hlsManifestUrl: null,
      dashManifestUrl: null,
    };
  }
  return invokeBackend<StreamInfo>("get_stream_info", { videoId, refresh });
}

export interface SabrDebugState {
  sessionId: string;
  videoId: string;
  effectiveUrl: string;
  requestCount: number;
  redirectCount: number;
  bytesUsed: number;
  done: boolean;
  lastError?: string | null;
  audioInitialized: boolean;
  videoInitialized: boolean;
  audioSegments: number;
  videoSegments: number;
  audioMaxSeq: number;
  videoMaxSeq: number;
  lastProtectionStatus: number;
}

export async function getSabrDebugState(
  sessionId: string,
): Promise<SabrDebugState | null> {
  if (!(await isTauriEnv())) return null;
  return invokeBackend<SabrDebugState | null>("get_sabr_debug_state", { sessionId });
}

export async function getChannelDetails(channelId: string): Promise<ChannelDetails> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Returning mock channel details.");
    return {
      id: channelId,
      name: "Mock Channel Name",
      description: "This is a mock channel description since Tauri was not detected.",
      avatarUrl: "📺",
      bannerUrl: "",
      subscriberCount: 154000,
      subscriberCountText: "154K subscribers",
      verified: true,
    };
  }
  return invokeBackend<ChannelDetails>("get_channel_details", { channelId });
}

/** Resolve a channel URL (handle / custom / user) to its canonical `UC…` id. */
export async function resolveChannelId(url: string): Promise<string> {
  if (!(await isTauriEnv())) {
    throw new Error("Channel resolution requires the desktop app.");
  }
  return invokeBackend<string>("resolve_channel_id", { url });
}

export async function getChannelTab(
  channelId: string,
  params?: string | null,
  pageToken?: string | null,
  query?: string | null,
): Promise<ChannelTabResponse> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Returning mock channel tab data.");
    
    let mockItems: ChannelItem[] = [];
    if (params?.includes("EgZzaG9ydHPyBgUKA5oBAA") || params?.includes("shorts")) {
      mockItems = [
        {
          type: "short",
          id: "mock-short-1",
          title: "Mock Shorts Content",
          thumbnailUrl: "https://images.unsplash.com/photo-1607799279861-4dd421887fb3?q=80&w=200",
          viewCountText: "50K views",
        },
      ];
    } else if (params?.includes("EglwbGF5bGlzdHPyBgQKAkIA") || params?.includes("playlists")) {
      mockItems = [
        {
          type: "playlist",
          id: "mock-playlist-1",
          title: "Mock Playlist Album",
          thumbnailUrl: "https://images.unsplash.com/photo-1607799279861-4dd421887fb3?q=80&w=300",
          videoCountText: "12 videos",
        },
      ];
    } else if (params?.includes("EgVwb3N0c_IGBAoCSgA") || params?.includes("posts") || params?.includes("community")) {
      mockItems = [
        {
          type: "post",
          id: "mock-post-1",
          authorName: "Mock Creator",
          authorAvatar: "📺",
          textContent: "Hello world! This is a beautiful mock community post since Tauri was not detected. Modern web design aesthetics are in full force!",
          publishedTimeText: "3 hours ago",
          likesCountText: "1.2K likes",
          commentCountText: "42",
          commentEndpointParams: null,
        },
      ];
    } else {
      mockItems = [
        {
          type: "video",
          id: "dQw4w9WgXcQ",
          title: "Mock Channel Video 1",
          channelName: "Mock Channel",
          thumbnailUrl: "https://images.unsplash.com/photo-1607799279861-4dd421887fb3?q=80&w=300",
          durationSeconds: 150,
          publishedText: "1 day ago",
          viewCountText: "10K views",
        },
      ];
    }

    return {
      channelId,
      items: mockItems,
      nextPageToken: null,
    };
  }
  return invokeBackend<ChannelTabResponse>("get_channel_tab", {
    channelId,
    params,
    pageToken,
    query,
  });
}

export async function getPlaylistDetails(
  playlistId: string,
  pageToken?: string | null,
): Promise<PlaylistDetailsResponse> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Returning mock playlist details.");
    return {
      id: playlistId,
      title: "Mock Playlist Title",
      description: "Mock playlist description.",
      channelName: "Mock Owner",
      videoCount: 1,
      viewCountText: "12K views",
      videos: [
        {
          id: "dQw4w9WgXcQ",
          title: "Mock Playlist Video 1",
          channelName: "Mock Owner",
          thumbnailUrl: "https://images.unsplash.com/photo-1607799279861-4dd421887fb3?q=80&w=300",
          durationSeconds: 120,
          publishedText: "3 days ago",
          viewCountText: "10K views",
        },
      ],
      nextPageToken: null,
    };
  }
  return invokeBackend<PlaylistDetailsResponse>("get_playlist_details", {
    playlistId,
    pageToken,
  });
}

export async function getComments(
  videoId: string,
  pageToken?: string | null,
): Promise<CommentsResponse> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Returning mock comments.");
    return {
      comments: [
        {
          id: "mock_c1",
          author: "Mock Commenter",
          authorThumbnail: null,
          text: "Wow! This application is incredibly fast and responsive!",
          publishedText: "2 hours ago",
          likeCount: 42,
          replyCount: 2,
        },
      ],
      nextPageToken: null,
    };
  }
  return invokeBackend<CommentsResponse>("get_comments", {
    videoId,
    pageToken,
  });
}

export async function getPostComments(
  postId: string,
  params?: string | null,
  pageToken?: string | null,
): Promise<CommentsResponse> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Returning mock post comments.");
    return {
      comments: [
        {
          id: "mock_pc1",
          author: "Mock Commenter",
          authorThumbnail: null,
          text: "Mock community post comment.",
          publishedText: "1 hour ago",
          likeCount: 12,
          replyCount: 0,
        },
      ],
      nextPageToken: null,
      commentCountText: "1",
    };
  }
  return invokeBackend<CommentsResponse>("get_post_comments", {
    postId,
    params,
    pageToken,
  });
}

export async function getLiveChat(
  videoId: string,
  continuation?: string | null,
): Promise<LiveChatResponse> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Returning mock live chat.");
    return { messages: [], continuation: null, pollingIntervalMs: 0, isReplay: false };
  }
  return invokeBackend<LiveChatResponse>("get_live_chat", { videoId, continuation });
}

export async function getTrendingVideos(): Promise<VideoSummary[]> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Returning mock trending videos.");
    return [
      {
        id: "dQw4w9WgXcQ",
        title: "Trending offline coding masterclass with Rust",
        channelName: "Fireship",
        thumbnailUrl: "https://images.unsplash.com/photo-1607799279861-4dd421887fb3?q=80&w=300",
        durationSeconds: 156,
        publishedText: "1 day ago",
        viewCountText: "500K views",
      },
    ];
  }
  return invokeBackend<VideoSummary[]>("get_trending_videos");
}

export async function getTrendingByCategory(
  category: TrendingCategory,
  region: string,
): Promise<VideoSummary[]> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Returning mock category videos.");
    return [
      {
        id: "dQw4w9WgXcQ",
        title: `${category === "all" ? "All" : category} category offline preview`,
        channelName: "Flow Preview",
        thumbnailUrl: "https://images.unsplash.com/photo-1607799279861-4dd421887fb3?q=80&w=300",
        durationSeconds: 156,
        publishedText: "1 day ago",
        viewCountText: "500K views",
      },
    ];
  }
  return invokeBackend<VideoSummary[]>("get_trending_videos", { category, region });
}

export async function getSearchSuggestions(query: string): Promise<string[]> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Returning mock suggestions.");
    return [
      `${query} tutorial`,
      `${query} crash course`,
      `${query} setup guide`,
      `${query} tips & tricks`,
    ];
  }
  return invokeBackend<string[]>("get_search_suggestions", { query });
}

export async function searchMusic(
  query: string,
  filter: string,
): Promise<Array<VideoSummary | PlaylistSummary>> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Returning mock music search results.");
    if (filter === "playlists") {
      return [
        {
          type: "playlist",
          id: "mock-search-playlist-1",
          title: `${query} Playlist`,
          thumbnailUrl: "https://images.unsplash.com/photo-1607799279861-4dd421887fb3?q=80&w=300",
          videoCountText: "18 videos",
        },
      ];
    }

    return [
      {
        id: "dQw4w9WgXcQ",
        title: `${query} (Lofi Remix)`,
        channelName: "Mock Artist",
        thumbnailUrl: "https://images.unsplash.com/photo-1607799279861-4dd421887fb3?q=80&w=300",
        durationSeconds: 240,
        publishedText: "Released 2026",
        viewCountText: "Song",
      },
    ];
  }
  return invokeBackend<VideoSummary[]>("search_music", { query, filter });
}

export async function parseSubscriptionExport(
  data: string,
): Promise<[string, string][]> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Returning mock parsed subscriptions.");
    return [
      ["UCsBjURrdU234nU351gVEfTA", "Fireship"],
      ["UCwRxwjk_c_92sAMeX4JzW4w", "Linus Tech Tips"],
    ];
  }
  return invokeBackend<[string, string][]>("parse_subscription_export", { data });
}

export async function getMusicLyrics(videoId: string): Promise<string | null> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Returning mock lyrics.");
    return "[00:10.00] This is a mock lyrics line\n[00:20.00] Singing natively in Flow Desktop!";
  }
  return invokeBackend<string | null>("get_music_lyrics", { videoId });
}

export async function getMusicRelated(videoId: string): Promise<VideoSummary[]> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Returning mock related songs.");
    return [
      {
        id: "dQw4w9WgXcQ",
        title: "Mock Related Hit",
        channelName: "Mock Artist",
        thumbnailUrl: "https://images.unsplash.com/photo-1607799279861-4dd421887fb3?q=80&w=300",
        durationSeconds: 180,
        publishedText: "3 months ago",
        viewCountText: "2M views",
      },
    ];
  }
  return invokeBackend<VideoSummary[]>("get_music_related", { videoId });
}

export async function getMusicAlbum(albumBrowseId: string): Promise<VideoSummary[]> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Returning mock album tracks.");
    return [
      {
        id: "dQw4w9WgXcQ",
        title: "Mock Album Track 1",
        channelName: "Mock Artist",
        thumbnailUrl: "https://images.unsplash.com/photo-1607799279861-4dd421887fb3?q=80&w=300",
        durationSeconds: 200,
        publishedText: "Track 1",
        viewCountText: "Album Track",
      },
    ];
  }
  return invokeBackend<VideoSummary[]>("get_music_album", { albumBrowseId });
}



export interface MusicHomeSection {
  sectionId: string;
  title: string;
  subtitle: string | null;
  tracks: VideoSummary[];
  orderBy: number;
}

export interface MusicHomeChip {
  title: string;
  browseId: string | null;
  params: string | null;
  orderBy: number;
}

/** @deprecated Legacy cached Music Home. Unused — the Music tab uses `getMusicHomePage`. */
export async function getMusicHome(): Promise<[MusicHomeSection[], MusicHomeChip[]]> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Returning mock Music Home.");
    return [[], []];
  }
  return invokeBackend<[MusicHomeSection[], MusicHomeChip[]]>("get_music_home");
}

/** @deprecated Legacy cached Music Home. Unused — the Music tab uses `getMusicHomePage`. */
export async function refreshMusicHome(): Promise<[MusicHomeSection[], MusicHomeChip[]]> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Returning mock Music Home.");
    return [[], []];
  }
  return invokeBackend<[MusicHomeSection[], MusicHomeChip[]]>("refresh_music_home");
}


export async function getSubscriptionRotationFeed(): Promise<VideoSummary[]> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Returning empty subscriptions rotation.");
    return [];
  }
  return invokeBackend<VideoSummary[]>("get_subscription_rotation_feed");
}

export interface SubscriptionRssChannel {
  id: string;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface SubscriptionRssFeed {
  videos: VideoSummary[];
  channels: SubscriptionRssChannel[];
  processed: number;
  total: number;
}

export async function getSubscriptionRssFeed(
  channelIds: string[],
  limit = 1500,
): Promise<SubscriptionRssFeed> {
  if (!(await isTauriEnv())) {
    console.warn("Tauri not detected. Returning mock subscription RSS feed.");
    return {
      videos: channelIds.slice(0, 4).map((channelId, index) => ({
        id: `mockrss${index}`.padEnd(11, "x").slice(0, 11),
        title: `Latest upload from subscribed channel ${index + 1}`,
        channelName: `Subscribed Channel ${index + 1}`,
        channelId,
        thumbnailUrl: "https://images.unsplash.com/photo-1607799279861-4dd421887fb3?q=80&w=640",
        publishedText: `${index + 1} days ago`,
        viewCountText: null,
        durationSeconds: null,
      })),
      channels: channelIds.map((id, index) => ({
        id,
        name: `Subscribed Channel ${index + 1}`,
        avatarUrl: null,
      })),
      processed: channelIds.length,
      total: channelIds.length,
    };
  }

  return invokeBackend<SubscriptionRssFeed>("get_subscription_rss_feed", {
    channelIds,
    limit,
  });
}

/**
 * Streaming variant of {@link getSubscriptionRssFeed}. The backend fetches
 * channels in batches and pushes the accumulated, re-sorted feed after each
 * batch, so the UI can fill in progressively instead of waiting for every
 * channel. `onBatch` fires once per emitted batch; the promise resolves when
 * the stream completes.
 */
export async function streamSubscriptionRssFeed(
  channelIds: string[],
  onBatch: (feed: SubscriptionRssFeed) => void,
  limit = 1500,
): Promise<void> {
  if (!(await isTauriEnv())) {
    onBatch(await getSubscriptionRssFeed(channelIds, limit));
    return;
  }

  const { Channel } = await import("@tauri-apps/api/core");
  const channel = new Channel<SubscriptionRssFeed>();
  channel.onmessage = onBatch;
  await invokeBackend<void>("stream_subscription_rss_feed", {
    channelIds,
    limit,
    onEvent: channel,
  });
}
