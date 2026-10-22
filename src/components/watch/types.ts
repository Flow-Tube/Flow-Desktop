import type { ReactNode } from "react";
import type {
  VideoSummary,
  VideoDetails,
  RelatedContentItem,
} from "../../types/video";
import type { DeArrowOverride, RydData } from "../../lib/api/foss";

export interface WatchLayoutSlots {
  player: ReactNode;
  metadata: ReactNode;
  description: ReactNode;
  comments: ReactNode;
  sidebar: ReactNode;
}

export type WatchLayoutProps = WatchLayoutSlots;

export interface FlowPlayerCoreProps {
  videoId: string;
  videoDetails: VideoDetails | null;
  onEnded?: () => void;
}

export interface WatchMetadataProps {
  currentVideo: VideoSummary;
  videoData: VideoDetails | null;
  dearrowData: DeArrowOverride | null;
  rydData: RydData | null;
}

export interface DescriptionCardProps {
  currentVideo: VideoSummary;
  videoData: VideoDetails | null;
  onSeek?: (seconds: number) => void;
}

export interface RelatedVideosProps {
  items: RelatedContentItem[];
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onSelect: (item: RelatedContentItem) => void;
  onAddToQueue?: (video: VideoSummary) => void;
}

export interface CommentsSectionProps {
  videoId: string;
  hideHeader?: boolean;
  postId?: string | null;
  postCommentParams?: string | null;
}

export interface LiveChatProps {
  videoId: string;
}

export interface WatchErrorStateProps {
  message: string;
  onRetryWithProxy?: () => void;
  onGoBack: () => void;
}
