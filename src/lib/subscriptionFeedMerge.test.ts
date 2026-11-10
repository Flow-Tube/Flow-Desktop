import { describe, expect, it } from "vitest";
import { isVideoOfChannel, mergeCollaborations, mergeScopedFeed } from "./subscriptionFeedMerge";
import type { VideoSummary } from "../types/video";

const video = (id: string, channelId: string, publishedText?: string): VideoSummary => ({
  id,
  title: id,
  channelName: channelId,
  channelId,
  publishedText,
});

describe("mergeScopedFeed", () => {
  it("leads with what is new, keeps other channels and drops what the channel no longer lists", () => {
    const previous = [video("a1", "a"), video("b1", "b"), video("a2", "a")];
    const merged = mergeScopedFeed(previous, ["a"], [video("a3", "a"), video("a1", "a")]);
    expect(merged.map((v) => v.id)).toEqual(["a3", "a1", "b1"]);
  });
});

describe("mergeCollaborations", () => {
  it("slots a collaboration by age and never repeats a video", () => {
    const feed = [video("new", "a", "1 hour ago"), video("old", "a", "3 days ago")];
    const merged = mergeCollaborations(feed, [video("collab", "z", "1 day ago"), video("old", "z", "3 days ago")]);
    expect(merged.map((v) => v.id)).toEqual(["new", "collab", "old"]);
  });

  it("puts one of unknown age last", () => {
    const merged = mergeCollaborations([video("a", "a", "1 hour ago")], [video("z", "z")]);
    expect(merged.map((v) => v.id)).toEqual(["a", "z"]);
  });
});

describe("isVideoOfChannel", () => {
  it("counts an uploader and a collaborator", () => {
    const collab = { ...video("v", "uploader"), collaborators: [{ channelId: "friend", name: "Friend" }] };
    expect(isVideoOfChannel(collab, "uploader")).toBe(true);
    expect(isVideoOfChannel(collab, "friend")).toBe(true);
    expect(isVideoOfChannel(collab, "other")).toBe(false);
  });
});
