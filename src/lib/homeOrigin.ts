import { getString } from "./i18n/index";
import type { HomeOrigin } from "./api/homeFeed";

/** The "Why you see this" line for a Home card. */
export function homeOriginLabel(origin: HomeOrigin): string {
  const detail = origin.detail?.trim();
  switch (origin.kind) {
    case "subscription":
      return getString("home_origin_subscription");
    case "related":
      return detail ? getString("home_origin_related", detail) : getString("home_origin_related_watched");
    case "search":
      return detail ? getString("home_origin_search", detail) : getString("home_origin_search_unnamed");
    case "channelMemory":
      return getString("home_origin_channel_memory");
    case "neighbour": {
      const names = (detail ?? "").split("|").filter(Boolean);
      if (names.length === 0) return getString("home_origin_neighbour_unnamed");
      const pointers = names.length === 1 ? names[0] : getString("home_origin_neighbour_pair", names[0], names[1]);
      return getString("home_origin_neighbour", pointers);
    }
  }
}
