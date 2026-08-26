import { beforeEach, describe, expect, it, vi } from "vitest";

const getDeArrowOverride = vi.fn();

vi.mock("./api/foss", () => ({
  getDeArrowOverride: (videoId: string) => getDeArrowOverride(videoId),
}));

const { loadDeArrowOverride } = await import("./useDeArrowOverride");

/*
 * The module cache is process-wide and has no reset hook by design, so every
 * test uses its own video id rather than reaching into internals.
 */
let nextId = 0;
const freshId = () => `vid${String(nextId++).padStart(8, "0")}`;

describe("loadDeArrowOverride", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDeArrowOverride.mockResolvedValue({ title: "Better title", thumbnailUrl: null });
  });

  /*
    The reason this layer exists: a feed mounts hundreds of cards at once, and
    each one used to issue its own IPC round trip and SQLite read.
  */
  it("issues one request no matter how many callers ask at once", async () => {
    const id = freshId();

    const results = await Promise.all([
      loadDeArrowOverride(id),
      loadDeArrowOverride(id),
      loadDeArrowOverride(id),
    ]);

    expect(getDeArrowOverride).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r?.title === "Better title")).toBe(true);
  });

  it("serves later callers from cache, so a remount costs nothing", async () => {
    const id = freshId();
    await loadDeArrowOverride(id);

    const again = await loadDeArrowOverride(id);

    expect(getDeArrowOverride).toHaveBeenCalledTimes(1);
    expect(again?.title).toBe("Better title");
  });

  it("caches a known-absent override so misses are not re-fetched either", async () => {
    const id = freshId();
    getDeArrowOverride.mockResolvedValue(null);

    expect(await loadDeArrowOverride(id)).toBeNull();
    expect(await loadDeArrowOverride(id)).toBeNull();
    expect(getDeArrowOverride).toHaveBeenCalledTimes(1);
  });

  /*
    A transient failure must not suppress the override for the rest of the
    session — DeArrow is an optional third-party API that rate-limits.
  */
  it("does not cache a failure, so a later attempt retries", async () => {
    const id = freshId();
    getDeArrowOverride.mockRejectedValueOnce(new Error("rate limited"));

    expect(await loadDeArrowOverride(id)).toBeNull();

    getDeArrowOverride.mockResolvedValue({ title: "Recovered", thumbnailUrl: null });
    expect((await loadDeArrowOverride(id))?.title).toBe("Recovered");
    expect(getDeArrowOverride).toHaveBeenCalledTimes(2);
  });

  it("keeps distinct videos separate", async () => {
    const [a, b] = [freshId(), freshId()];

    await Promise.all([loadDeArrowOverride(a), loadDeArrowOverride(b)]);

    expect(getDeArrowOverride).toHaveBeenCalledTimes(2);
    expect(getDeArrowOverride).toHaveBeenCalledWith(a);
    expect(getDeArrowOverride).toHaveBeenCalledWith(b);
  });
});
