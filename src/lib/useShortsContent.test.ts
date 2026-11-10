import { describe, expect, it } from "vitest";
import { channelTabsFor, shortsPlayerDisabledNow, videosWithShorts } from "./useShortsContent";
import { SETTINGS } from "./settings/schema";
import { useAppSettingsStore } from "../store/useAppSettingsStore";

const tabs = [{ kind: "videos" }, { kind: "shorts" }];

describe("channelTabsFor", () => {
  it("keeps the Shorts tab while Shorts show", () => {
    expect(channelTabsFor(tabs, true, false)).toEqual(tabs);
  });

  it("drops it when Shorts are hidden, unless the viewer kept it", () => {
    expect(channelTabsFor(tabs, false, false)).toEqual([{ kind: "videos" }]);
    expect(channelTabsFor(tabs, false, true)).toEqual(tabs);
  });
});

describe("videosWithShorts", () => {
  const videos = [{ id: "s", isShort: true }, { id: "v" }];

  it("takes Shorts out only when they are hidden", () => {
    expect(videosWithShorts(videos, true)).toBe(videos);
    expect(videosWithShorts(videos, false)).toEqual([{ id: "v" }]);
  });
});

describe("shortsPlayerDisabledNow", () => {
  const withValues = (values: Record<string, string>) => {
    useAppSettingsStore.setState({ values });
    return shortsPlayerDisabledNow();
  };

  it("is on when Shorts are hidden, or by the viewer's own switch", () => {
    expect(withValues({})).toBe(false);
    expect(withValues({ [SETTINGS.SHORTS_CONTENT_ENABLED]: "false" })).toBe(true);
    expect(withValues({ [SETTINGS.DISABLE_SHORTS_PLAYER]: "true" })).toBe(true);
    useAppSettingsStore.setState({ values: {} });
  });
});
