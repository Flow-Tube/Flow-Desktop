import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SponsorBlockSegment } from "./api/foss";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getSponsorBlockSegments = vi.fn();
const offlineRecords = new Map<string, { sponsorblockJson: string }>();
const settings = { sponsorBlockEnabled: true, serverUrl: "https://sb.example" };
let storeSegments: SponsorBlockSegment[] = [];

vi.mock("./api/foss", () => ({
  getSponsorBlockSegments: (...args: unknown[]) => getSponsorBlockSegments(...args),
}));
vi.mock("./useDownloads", () => ({
  useDownloadedVideoRecord: (id: string) => offlineRecords.get(id),
  downloadSponsorSegments: (record: { sponsorblockJson: string }) => JSON.parse(record.sponsorblockJson),
}));
vi.mock("../store/useSettingsStore", () => ({
  useSettingsStore: { getState: () => ({ ...settings, loadSettings: async () => {} }) },
}));
vi.mock("../store/usePlayerStore", () => ({
  usePlayerStore: (selector: (state: unknown) => unknown) =>
    selector({
      setSponsorBlockSegments: stableSetSegments,
    }),
}));
const stableSetSegments = (segments: SponsorBlockSegment[]) => {
  storeSegments = segments;
};

import { useSponsorBlockSegments } from "./useSponsorBlockSegments";

const segment = (uuid: string) => ({ UUID: uuid, category: "sponsor", segment: [10, 20] }) as SponsorBlockSegment;

function Probe({ videoId }: { videoId: string | null }) {
  useSponsorBlockSegments(videoId);
  return null;
}

describe("useSponsorBlockSegments", () => {
  let root: Root;
  const render = (videoId: string | null) =>
    act(async () => {
      root.render(createElement(Probe, { videoId }));
    });

  beforeEach(() => {
    root = createRoot(document.createElement("div"));
    getSponsorBlockSegments.mockReset();
    offlineRecords.clear();
    settings.sponsorBlockEnabled = true;
    storeSegments = [];
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  it("loads the segments of the video being played", async () => {
    getSponsorBlockSegments.mockResolvedValue([segment("a")]);
    await render("video-a");
    expect(getSponsorBlockSegments).toHaveBeenCalledWith("video-a", "https://sb.example");
    expect(storeSegments.map((s) => s.UUID)).toEqual(["a"]);
  });

  it("drops the last video's segments when the next video's request fails", async () => {
    getSponsorBlockSegments.mockResolvedValueOnce([segment("a")]);
    await render("video-a");
    getSponsorBlockSegments.mockRejectedValueOnce(new Error("offline"));
    await render("video-b");
    expect(storeSegments).toEqual([]);
  });

  it("has no segments while the next video's request is still on its way", async () => {
    getSponsorBlockSegments.mockResolvedValueOnce([segment("a")]);
    await render("video-a");
    getSponsorBlockSegments.mockReturnValueOnce(new Promise(() => {}));
    await render("video-b");
    expect(storeSegments).toEqual([]);
  });

  it("ignores an answer for a video that is no longer playing", async () => {
    let answerForA: (segments: SponsorBlockSegment[]) => void = () => {};
    getSponsorBlockSegments.mockReturnValueOnce(
      new Promise<SponsorBlockSegment[]>((resolve) => {
        answerForA = resolve;
      }),
    );
    await render("video-a");
    getSponsorBlockSegments.mockResolvedValueOnce([segment("b")]);
    await render("video-b");
    await act(async () => answerForA([segment("a")]));
    expect(storeSegments.map((s) => s.UUID)).toEqual(["b"]);
  });

  it("uses the segments stored with a download, without asking the server", async () => {
    offlineRecords.set("saved", { sponsorblockJson: JSON.stringify([segment("stored")]) });
    await render("saved");
    expect(getSponsorBlockSegments).not.toHaveBeenCalled();
    expect(storeSegments.map((s) => s.UUID)).toEqual(["stored"]);
  });

  it("stays empty when SponsorBlock is off", async () => {
    settings.sponsorBlockEnabled = false;
    await render("video-a");
    expect(getSponsorBlockSegments).not.toHaveBeenCalled();
    expect(storeSegments).toEqual([]);
  });
});
