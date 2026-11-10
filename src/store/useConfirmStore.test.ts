import { beforeEach, describe, expect, it } from "vitest";
import { useConfirmStore } from "./useConfirmStore";

describe("useConfirmStore", () => {
  beforeEach(() => {
    useConfirmStore.setState({ pending: null });
  });

  it("waits for the answer before resolving", async () => {
    let settled = false;
    const answer = useConfirmStore.getState().ask({ title: "Delete?", message: "Gone for good." }).then((confirmed) => {
      settled = true;
      return confirmed;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(useConfirmStore.getState().pending?.title).toBe("Delete?");

    useConfirmStore.getState().answer(true);
    await expect(answer).resolves.toBe(true);
    expect(useConfirmStore.getState().pending).toBeNull();
  });

  it("resolves false on cancel", async () => {
    const answer = useConfirmStore.getState().ask({ title: "Delete?", message: "Gone for good." });
    useConfirmStore.getState().answer(false);
    await expect(answer).resolves.toBe(false);
  });

  it("declines a question that a newer one replaces", async () => {
    const first = useConfirmStore.getState().ask({ title: "First?", message: "" });
    const second = useConfirmStore.getState().ask({ title: "Second?", message: "" });
    await expect(first).resolves.toBe(false);
    expect(useConfirmStore.getState().pending?.title).toBe("Second?");

    useConfirmStore.getState().answer(true);
    await expect(second).resolves.toBe(true);
  });
});
