import type { ChannelItem, ChannelSection, ChannelTab } from "../types/video";

/** How a list of channel items is laid out. */
export type ChannelLayout = "videos" | "shorts" | "playlists" | "posts" | "channels";

/** The tab kinds the page can show; Store and unknown tabs are left out. */
const RENDERED_KINDS = new Set([
  "home",
  "videos",
  "shorts",
  "live",
  "podcasts",
  "playlists",
  "releases",
  "courses",
  "posts",
]);

const LAYOUT_OF_TYPE: Record<ChannelItem["type"], ChannelLayout> = {
  video: "videos",
  short: "shorts",
  playlist: "playlists",
  post: "posts",
  channel: "channels",
};

/** A tab is shown when the page can render it and, past Home, knows how to load it. */
export function visibleTabs(tabs: ChannelTab[]): ChannelTab[] {
  return tabs.filter((tab) => RENDERED_KINDS.has(tab.kind) && (tab.kind === "home" || !!tab.params));
}

export function layoutForKind(kind: string): ChannelLayout {
  switch (kind) {
    case "videos":
    case "live":
    case "search":
      return "videos";
    case "shorts":
      return "shorts";
    case "posts":
      return "posts";
    default:
      return "playlists";
  }
}

/** A shelf is laid out by the kind most of its items are; the rest are left out of it. */
export function sectionLayout(section: ChannelSection): ChannelLayout {
  const counts = new Map<ChannelLayout, number>();
  for (const item of section.items) {
    const layout = LAYOUT_OF_TYPE[item.type];
    counts.set(layout, (counts.get(layout) ?? 0) + 1);
  }
  let best: ChannelLayout = "videos";
  let most = 0;
  for (const [layout, count] of counts) {
    if (count > most) {
      best = layout;
      most = count;
    }
  }
  return best;
}

export function itemsOfLayout<T extends ChannelItem>(items: ChannelItem[], layout: ChannelLayout): T[] {
  return items.filter((item) => LAYOUT_OF_TYPE[item.type] === layout) as T[];
}

export function channelItemKey(item: ChannelItem): string {
  return item.type === "channel" ? `channel:${item.channelId}` : `${item.type}:${item.id}`;
}

/** A further page appended to what is shown, without repeating what a page overlap sent twice. */
export function mergeChannelItems(shown: ChannelItem[], page: ChannelItem[]): ChannelItem[] {
  const seen = new Set(shown.map(channelItemKey));
  return [...shown, ...page.filter((item) => !seen.has(channelItemKey(item)))];
}

/** The tab a section's "See all" belongs to: the tab with its params, else one of its layout. */
export function tabForSection(section: ChannelSection, tabs: ChannelTab[]): ChannelTab | undefined {
  const params = section.more?.params;
  if (!params) return undefined;
  const exact = tabs.find((tab) => tab.params === params);
  if (exact) return exact;
  const layout = sectionLayout(section);
  return tabs.find((tab) => tab.kind !== "home" && layoutForKind(tab.kind) === layout);
}
