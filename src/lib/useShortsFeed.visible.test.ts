import { beforeEach, describe, expect, it } from "vitest";
import { SETTINGS } from "./settings/schema";
import { visibleFetchedShorts } from "./useShortsFeed";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { useFeedActionsStore } from "../store/useFeedActionsStore";
import type { ShortItem } from "../types/shorts";

const short = (id: string) => ({ id, channelId: null }) as unknown as ShortItem;
const setHideWatched = (value: string) =>
  useAppSettingsStore.setState((state) => ({
    values: { ...state.values, [SETTINGS.HIDE_WATCHED_SHORTS]: value },
  }));

describe("visibleFetchedShorts", () => {
  beforeEach(() => {
    useFeedActionsStore.setState({ watchedVideoIds: new Set(["marked"]), dismissedVideoIds: new Set(["dismissed"]) });
  });

  it("leaves out watched and finished Shorts while the switch is on", () => {
    setHideWatched("true");
    const items = [short("marked"), short("finished"), short("fresh")];
    expect(visibleFetchedShorts(items, new Set(["finished"])).map((item) => item.id)).toEqual(["fresh"]);
  });

  it("keeps them with the switch off, but never what the viewer dismissed", () => {
    setHideWatched("false");
    const items = [short("marked"), short("finished"), short("dismissed")];
    expect(visibleFetchedShorts(items, new Set(["finished"])).map((item) => item.id)).toEqual(["marked", "finished"]);
  });
});
