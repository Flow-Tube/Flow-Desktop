import { describe, expect, it } from "vitest";
import { useChannelUploadsStore } from "./useChannelUploadsStore";
import type { VideoSummary } from "../types/video";

const video = (channelId: string) => ({ id: channelId, title: "", channelName: "", channelId }) as VideoSummary;

describe("useChannelUploadsStore", () => {
  it("keeps the last feed's channel order and ignores an empty feed", () => {
    useChannelUploadsStore.getState().noteFeed([video("b"), video("a"), video("b")]);
    useChannelUploadsStore.getState().noteFeed([]);

    expect(useChannelUploadsStore.getState().newestFirst).toEqual(["b", "a"]);
  });
});
