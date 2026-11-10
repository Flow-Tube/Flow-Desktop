export interface ShortItem {
  id: string;
  title: string;
  channelName: string;
  channelId?: string | null;
  thumbnailUrl: string;
  channelAvatarUrl?: string | null;
  viewCountText?: string | null;
  likeCountText?: string | null;
  commentCountText?: string | null;
  publishedText?: string | null;
  sequenceParams?: string | null;
  /** The full video this Short links to. */
  linkedVideoId?: string | null;
  linkedVideoTitle?: string | null;
}

export interface ShortsFeed {
  items: ShortItem[];
  continuation: string | null;
}

export type ShortsPanelState = "none" | "comments" | "description";
