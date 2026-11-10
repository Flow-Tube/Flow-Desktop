import { afterEach, describe, expect, it } from "vitest";
import { musicEnabledNow, withMusic } from "./useMusicContent";
import { SETTINGS } from "./settings/schema";
import { useAppSettingsStore } from "../store/useAppSettingsStore";

describe("withMusic", () => {
  const items = [{ id: "song", isMusic: true }, { id: "video" }];

  it("takes songs out only while Show Music is off", () => {
    expect(withMusic(items, true)).toBe(items);
    expect(withMusic(items, false)).toEqual([{ id: "video" }]);
  });
});

describe("musicEnabledNow", () => {
  afterEach(() => useAppSettingsStore.setState({ values: {} }));

  it("is on until the switch is turned off", () => {
    expect(musicEnabledNow()).toBe(true);
    useAppSettingsStore.setState({ values: { [SETTINGS.MUSIC_CONTENT_ENABLED]: "false" } });
    expect(musicEnabledNow()).toBe(false);
  });
});
