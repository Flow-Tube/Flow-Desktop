import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const youtube = vi.hoisted(() => ({ getVideoDetails: vi.fn(), getChannelDetails: vi.fn() }));
vi.mock("../api/youtube", () => youtube);
const api = vi.hoisted(() => ({ saveNoteSubject: vi.fn(async () => {}) }));
vi.mock("../api/notes", async (original) => ({ ...(await original<typeof import("../api/notes")>()), ...api }));

const { fillMissingSubjects } = await import("./useNoteBackfill");
const { useNotesStore } = await import("../../store/useNotesStore");

const video = (id: string, title?: string) => ({
  id: `video:${id}`,
  targetId: id,
  kind: "Video" as const,
  text: "x",
  updatedAt: 1,
  title,
});

beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
afterEach(() => vi.clearAllMocks());

describe("fillMissingSubjects", () => {
  it("fetches only notes that lack a subject, and each once", async () => {
    const missing = video("fill-once");
    useNotesStore.setState({ notes: { [missing.id]: missing } });
    youtube.getVideoDetails.mockResolvedValue({ title: "Found", channelName: "C" });
    await fillMissingSubjects([missing, video("known", "Has one")]);
    await fillMissingSubjects([missing]);
    expect(youtube.getVideoDetails).toHaveBeenCalledTimes(1);
    expect(youtube.getVideoDetails).toHaveBeenCalledWith("fill-once");
    expect(useNotesStore.getState().notes[missing.id]?.title).toBe("Found");
  });

  it("reads a channel note from its channel", async () => {
    const channel = { ...video("UCx"), id: "channel:UCx", kind: "Channel" as const };
    useNotesStore.setState({ notes: { [channel.id]: channel } });
    youtube.getChannelDetails.mockResolvedValue({ id: "UCx", name: "A channel", avatarUrl: "a", handle: "@a" });
    await fillMissingSubjects([channel]);
    expect(useNotesStore.getState().notes[channel.id]).toMatchObject({ title: "A channel", channelHandle: "@a" });
  });

  it("stays quiet when the network fails", async () => {
    const missing = video("offline");
    useNotesStore.setState({ notes: { [missing.id]: missing } });
    youtube.getVideoDetails.mockRejectedValue(new Error("offline"));
    await expect(fillMissingSubjects([missing])).resolves.toBeUndefined();
    expect(useNotesStore.getState().notes[missing.id]?.title).toBeUndefined();
  });
});
