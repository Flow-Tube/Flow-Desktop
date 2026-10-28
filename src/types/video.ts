export interface VideoSummary {
  id: string;
  title: string;
  channelName: string;
  channelId?: string | null;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  publishedText?: string | null;
  /** Epoch ms a stored track's relative `publishedText` is pinned to. */
  publishedAt?: number | null;
  /** Epoch ms a stored track was added to its playlist; missing for tracks saved before it was kept. */
  addedAtInPlaylist?: number | null;
  viewCountText?: string | null;
  channelAvatarUrl?: string | null;
  watchProgressPercent?: number | null;
  isLive?: boolean | null;
  /** The view count as a number, read from `viewCountText`. */
  viewCount?: number | null;
  /** A premiere or scheduled stream that has not started. */
  isUpcoming?: boolean;
  /** When an upcoming video starts, in epoch milliseconds. */
  upcomingStartMs?: number | null;
  /** A Short, known from the card itself rather than guessed from its length. */
  isShort?: boolean;
  isVerified?: boolean;
  isMembersOnly?: boolean;
  /** The card's own badges as YouTube labels them ("4K", "CC", "New"). */
  badges?: string[];
  /** The channels behind a collaboration, the lead first; empty for one channel. */
  collaborators?: Collaborator[];
  /** The description excerpt search results show. */
  snippet?: string | null;
}

/** One channel of a collaboration. */
export interface Collaborator {
  channelId: string;
  name: string;
  avatarUrl?: string | null;
  handle?: string | null;
  subscriberCountText?: string | null;
}

export interface RelatedContentItem {
  id: string;
  itemType: "video" | "playlist" | "mix" | string;
  title: string;
  channelName: string;
  channelId?: string | null;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  publishedText?: string | null;
  viewCountText?: string | null;
  videoId?: string | null;
  playlistId?: string | null;
  isMix: boolean;
  isLive?: boolean | null;
  channelAvatarUrl?: string | null;
  isUpcoming?: boolean;
  isVerified?: boolean;
  isMembersOnly?: boolean;
  /** A video card that opens the Shorts player. */
  isShort?: boolean;
  badges?: string[];
  collaborators?: Collaborator[];
}

export interface VideoChapter {
  title: string;
  startSeconds: number;
  endSeconds: number;
  thumbnailUrl?: string | null;
}

/** What a link in a description or comment points at. */
export type RichTarget =
  | { kind: "timestamp"; seconds: number }
  | { kind: "video"; videoId: string; startSeconds?: number | null }
  | { kind: "playlist"; playlistId: string }
  | { kind: "channel"; channelId: string }
  | { kind: "hashtag"; tag: string }
  | { kind: "url"; url: string };

export interface RichSpan {
  /** Offsets count UTF-16 code units, as JavaScript strings do. */
  start: number;
  length: number;
  target: RichTarget;
}

export interface RichEmoji {
  start: number;
  length: number;
  imageUrl: string;
  label: string;
}

/** Text with its links and the custom emoji drawn over it. */
export interface RichText {
  text: string;
  spans: RichSpan[];
  emojis: RichEmoji[];
}

export interface DescriptionExtras {
  /** Headline numbers: "19M" "Likes". */
  factoids: { value: string; label: string }[];
  /** Songs credited in the video. */
  music: { title: string; artist?: string | null; album?: string | null; thumbnailUrl?: string | null }[];
  /** The creator's own links. */
  links: { title: string; url: string }[];
}

/** One slice of the "most replayed" graph, with how often it is replayed from 0 to 1. */
export interface HeatmapMarker {
  startMs: number;
  durationMs: number;
  intensity: number;
}

export interface RelatedPage {
  items: RelatedContentItem[];
  continuation?: string | null;
}

/** What a listed video is, from one small request that stays out of playback's way. */
export interface VideoMetadata {
  title: string;
  channelName: string;
  channelId?: string | null;
  durationSeconds?: number | null;
  viewCount?: number | null;
  /** The upload time, exact, in epoch milliseconds. */
  publishedAtMs?: number | null;
  isLive: boolean;
  category?: string | null;
}

export interface VideoDetails {
  id: string;
  title: string;
  channelName: string;
  channelId?: string | null;
  description?: string | null;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  likeCountText?: string | null;
  viewCountText?: string | null;
  publishedText?: string | null;
  chapters?: VideoChapter[];
  isLive?: boolean | null;
  /** YouTube's category ("Gaming", "Education") from the player's microformat. */
  category?: string | null;
  /** "16 years ago", next to the absolute `publishedText`. */
  relativePublishedText?: string | null;
  channelAvatarUrl?: string | null;
  subscriberCountText?: string | null;
  channelBadge?: "verified" | "artist" | null;
  /** The channels of a collaboration, the uploader first; empty otherwise. */
  collaborators?: Collaborator[];
  hashtags?: string[];
  /** Labels such as "Unlisted" or "Members only" under the title. */
  badges?: string[];
  /** The chapters were generated by YouTube rather than the creator. */
  autoChapters?: boolean;
  heatmap?: HeatmapMarker[];
  /** The video YouTube would play next. */
  autoplayVideoId?: string | null;
  /** A finished stream whose chat can be replayed alongside it. */
  hasChatReplay?: boolean;
  /** The description with its links, when it could be read with them. */
  descriptionRich?: RichText | null;
  descriptionExtras?: DescriptionExtras;
}

export interface StreamInfo {
  streamId: string;
  localUrl: string;
  expiresAt: string;
  variants: StreamVariant[];
  captions: CaptionTrack[];
  audioTracks: AudioTrack[];
  hlsManifestUrl?: string | null;
  dashManifestUrl?: string | null;
  isLive?: boolean | null;
  sabr?: SabrStreamInfo | null;
  /** Seek-bar preview sheets, one entry per resolution, smallest first. */
  storyboard?: StoryboardLevel[];
  /** How many dB louder than the site's target the video plays. */
  loudnessDb?: number | null;
}

/** One resolution of a video's preview frames: sheets of `columns` × `rows`, one frame every `intervalMs`. */
export interface StoryboardLevel {
  width: number;
  height: number;
  count: number;
  columns: number;
  rows: number;
  intervalMs: number;
  /** `$M` numbers the sheet. */
  urlTemplate: string;
}

export interface LiveChatSegment {
  text: string;
  emojiImageUrl?: string | null;
}

export type LiveChatMessageType = "text" | "superChat" | "membership";

export interface LiveChatMessage {
  id: string;
  author: string;
  authorPhotoUrl?: string | null;
  message: string;
  segments: LiveChatSegment[];
  timestamp?: string | null;
  messageType: LiveChatMessageType;
  isOwner: boolean;
  isModerator: boolean;
  isVerified: boolean;
  isMember: boolean;
  memberBadgeUrl?: string | null;
  superChatAmount?: string | null;
  superChatArgb?: number | null;
  superChatHeaderArgb?: number | null;
  /** Where in a replayed stream the message was sent. */
  videoOffsetMs?: number | null;
}

export interface LiveChatResponse {
  messages: LiveChatMessage[];
  continuation?: string | null;
  pollingIntervalMs: number;
  isReplay: boolean;
  /** Tokens that restart the chat as "Top chat" or as every message. */
  topChatContinuation?: string | null;
  allChatContinuation?: string | null;
  /** A replay token that jumps to another playback position. */
  seekContinuation?: string | null;
}

/** SABR (Server Adaptive Bit Rate) availability + local manifest endpoint. */
export interface SabrStreamInfo {
  available: boolean;
  manifestUrl?: string | null;
  audioUrl?: string | null;
  videoUrl?: string | null;
  selectedAudioItag?: number | null;
  selectedVideoItag?: number | null;
  expiresInSeconds?: number | null;
  requiresPoToken: boolean;
  reasonUnavailable?: string | null;
}

export interface StreamVariant {
  id: string;
  localUrl: string;
  qualityLabel: string;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  bitrate?: number | null;
  contentLength?: number | null;
  isDefault: boolean;
  isPlayable: boolean;
  hasAudio: boolean;
  isVideoOnly: boolean;
  deliveryMethod: string;
  // Range metadata serialized by the backend (used to build synthetic DASH).
  initRangeStart?: number | null;
  initRangeEnd?: number | null;
  indexRangeStart?: number | null;
  indexRangeEnd?: number | null;
  approxDurationMs?: number | null;
}

export interface CaptionTrack {
  id: string;
  label: string;
  languageCode: string;
  url: string;
  isAutoGenerated: boolean;
  /** A machine translation of another track, offered under Auto-translate. */
  isTranslation?: boolean;
}

export interface AudioTrack {
  id: string;
  label: string;
  languageCode?: string | null;
  audioTrackType?: string | null;
  localUrl: string;
  mimeType?: string | null;
  bitrate?: number | null;
  contentLength?: number | null;
  isDefault: boolean;
  /** Whether this track has a playable direct URL. Only the original track is offered, so this is always true. */
  available: boolean;
  initRangeStart?: number | null;
  initRangeEnd?: number | null;
  indexRangeStart?: number | null;
  indexRangeEnd?: number | null;
  approxDurationMs?: number | null;
}

export type SearchFeature =
  | "live"
  | "4k"
  | "hd"
  | "subtitles"
  | "creative_commons"
  | "360"
  | "hdr"
  | "vr180"
  | "3d"
  | "location";

export interface SearchVideosRequest {
  query: string;
  pageToken?: string | null;
  /** Relevance (the default) or view count; YouTube reorders by nothing else. */
  sortBy?: "relevance" | "views" | null;
  /** Server-side upload-date window. Omit/`any` for no filter. */
  uploadDate?: "any" | "hour" | "today" | "week" | "month" | "year" | null;
  /** Under 3 minutes, 3 to 20, or over 20. Omit/`any` for no filter. */
  duration?: "any" | "short" | "medium" | "long" | null;
  contentType?: "video" | "shorts" | "channel" | "playlist" | "movie" | null;
  /** Features that must all hold. */
  features?: SearchFeature[];
  /** Search for the query as typed, without YouTube's spelling correction. */
  exact?: boolean;
}

/** A channel among the search results. */
export interface SearchChannel {
  channelId: string;
  name: string;
  handle?: string | null;
  avatarUrl?: string | null;
  subscriberCountText?: string | null;
  videoCountText?: string | null;
  description?: string | null;
  isVerified: boolean;
}

/** A titled run of videos in the results ("Latest from Linus Tech Tips"). */
export interface SearchShelf {
  title: string;
  videos: VideoSummary[];
}

/** One autocomplete row; well-known people, places and things carry a knowledge card. */
export interface SearchSuggestion {
  text: string;
  entity: SuggestionEntity | null;
}

export interface SuggestionEntity {
  title: string;
  description: string | null;
  image: string | null;
}

/** YouTube's spelling correction: results already shown for `query`, or only suggested. */
export interface SearchCorrection {
  query: string;
  original?: string | null;
  applied: boolean;
}

export interface SearchVideosResponse {
  /** The video results, in order, without Shorts. */
  items: VideoSummary[];
  nextPageToken?: string | null;
  source: string;
  channels?: SearchChannel[];
  playlists?: Omit<PlaylistSummary, "type">[];
  shorts?: Omit<ShortVideoSummary, "type">[];
  shelves?: SearchShelf[];
  correction?: SearchCorrection | null;
}

/** One of a channel's tabs; `kind` comes from its URL, `title` arrives localised. */
export interface ChannelTab {
  kind: string;
  title: string;
  params?: string | null;
  selected: boolean;
}

export interface ChannelDetails {
  id: string;
  name: string;
  handle?: string | null;
  description?: string | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  subscriberCount?: number | null;
  subscriberCountText?: string | null;
  videoCountText?: string | null;
  verified: boolean;
  tabs: ChannelTab[];
  /** Loads the About panel. */
  aboutToken?: string | null;
}

export interface ChannelLink {
  title: string;
  url: string;
  iconUrl?: string | null;
}

export interface ChannelAbout {
  description?: string | null;
  countryText?: string | null;
  joinedDateText?: string | null;
  viewCountText?: string | null;
  videoCountText?: string | null;
  subscriberCountText?: string | null;
  canonicalUrl?: string | null;
  links: ChannelLink[];
}

export interface ShortVideoSummary {
  type: "short";
  id: string;
  title: string;
  channelName?: string | null;
  channelId?: string | null;
  thumbnailUrl?: string | null;
  channelAvatarUrl?: string | null;
  viewCountText?: string | null;
  publishedText?: string | null;
}

export interface PlaylistSummary {
  type: "playlist";
  id: string;
  title: string;
  thumbnailUrl?: string | null;
  videoCountText?: string | null;
}

export interface PollChoice {
  text: string;
  /** Share of the votes from 0 to 1, when the post shows results. */
  voteRatio?: number | null;
  voteCountText?: string | null;
}

export interface QuizChoice {
  text: string;
  isCorrect: boolean;
  explanation?: string | null;
}

/** What a post carries besides its text. A single image is a one-picture gallery. */
export type PostAttachment =
  | { kind: "images"; urls: string[] }
  | { kind: "poll"; choices: PollChoice[]; totalVotesText?: string | null }
  | { kind: "quiz"; choices: QuizChoice[]; totalVotesText?: string | null }
  | { kind: "video"; video: VideoSummary };

export interface PostSummary {
  type: "post";
  id: string;
  authorName: string;
  authorAvatar?: string | null;
  textContent?: string | null;
  attachment?: PostAttachment | null;
  likesCountText?: string | null;
  commentCountText?: string | null;
  commentEndpointParams?: string | null;
  publishedTimeText?: string | null;
}

export interface VideoItemSummary extends VideoSummary {
  type: "video";
}

/** A channel listed on another channel's page ("Featured Channels"). */
export interface ChannelSummaryItem {
  type: "channel";
  channelId: string;
  name: string;
  avatarUrl?: string | null;
  subscriberCountText?: string | null;
}

export type ChannelItem =
  | VideoItemSummary
  | ShortVideoSummary
  | PlaylistSummary
  | PostSummary
  | ChannelSummaryItem;

/** Where a section's "See all" leads: a tab's browse params or a playlist. */
export interface ChannelSectionMore {
  params?: string | null;
  playlistId?: string | null;
}

/** A titled run on a channel's Home tab, in the channel's own order. */
export interface ChannelSection {
  title: string;
  items: ChannelItem[];
  more?: ChannelSectionMore | null;
  isTrailer: boolean;
}

/** Chips and sort sheets reload by `continuation`; the Playlists sort menu re-browses with `params`. */
export interface ChannelFilterOption {
  label: string;
  selected: boolean;
  continuation?: string | null;
  params?: string | null;
}

export interface ChannelFilterGroup {
  title?: string | null;
  isDropdown: boolean;
  options: ChannelFilterOption[];
}

export interface ChannelTabResponse {
  channelId: string;
  items: ChannelItem[];
  nextPageToken?: string | null;
  /** Home's shelves; empty for a grid tab. */
  sections: ChannelSection[];
  filters: ChannelFilterGroup[];
}

export interface ChannelPage {
  details: ChannelDetails;
  home: ChannelTabResponse;
}

export interface PlaylistDetailsResponse {
  id: string;
  title: string;
  description?: string | null;
  channelName: string;
  videoCount?: number | null;
  viewCountText?: string | null;
  videos: VideoSummary[];
  nextPageToken?: string | null;
}

export interface Comment {
  id: string;
  author: string;
  authorThumbnail?: string | null;
  authorChannelId?: string | null;
  text: string;
  publishedText?: string | null;
  likeCount?: number | null;
  replyCount?: number | null;
  continuationToken?: string | null;
  /** The text with its links, timestamps and custom emoji. */
  richText?: RichText | null;
  likeCountText?: string | null;
  isPinned?: boolean;
  /** "Pinned by @Creator". */
  pinnedText?: string | null;
  isHearted?: boolean;
  /** "❤ by @Creator". */
  heartedByText?: string | null;
  isVerified?: boolean;
  /** The comment is by the video's own channel. */
  isCreator?: boolean;
  isArtist?: boolean;
}

/** One way to order the comments, and the token that loads them that way. */
export interface CommentSort {
  title: string;
  token: string;
  selected: boolean;
}

export interface CommentsResponse {
  comments: Comment[];
  nextPageToken?: string | null;
  commentCountText?: string | null;
  /** Top and Newest, from the first page's header. */
  sortOptions?: CommentSort[];
  /** The exact count from that header. */
  totalCount?: number | null;
  /** The creator turned comments off. */
  commentsDisabled?: boolean;
}

/** Explore's destinations, as Flow for Android lists them. */
export type ExploreDestinationId = "live" | "gaming" | "music" | "news" | "sports" | "learning" | "fashion";

/** A page to browse: a destination, one of its tabs, or a shelf's full grid. */
export interface ExploreTarget {
  browseId: string;
  params?: string | null;
}

export interface ExploreShelf {
  title: string;
  videos: VideoSummary[];
  /** The grid "See all" opens. */
  more?: ExploreTarget | null;
}

export interface ExploreTab {
  title: string;
  target: ExploreTarget;
  selected: boolean;
}

export interface ExplorePage {
  title?: string | null;
  tabs: ExploreTab[];
  shelves: ExploreShelf[];
}

export interface ExploreGrid {
  videos: VideoSummary[];
  continuation?: string | null;
}
