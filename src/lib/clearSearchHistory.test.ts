import { beforeEach, describe, expect, it } from "vitest";
import { clearSearchHistoryAfterAsking } from "./clearSearchHistory";
import { useConfirmStore } from "../store/useConfirmStore";
import { useSearchHistoryStore } from "../store/useSearchHistoryStore";

async function answer(confirmed: boolean) {
  const cleared = clearSearchHistoryAfterAsking();
  expect(useConfirmStore.getState().pending?.destructive).toBe(true);
  useConfirmStore.getState().answer(confirmed);
  return cleared;
}

describe("clearSearchHistoryAfterAsking", () => {
  beforeEach(() => {
    useSearchHistoryStore.setState({ entries: [{ query: "lofi", at: 1 }] });
  });

  it("keeps the history when the user cancels", async () => {
    expect(await answer(false)).toBe(false);
    expect(useSearchHistoryStore.getState().entries).toHaveLength(1);
  });

  it("clears it once the user confirms", async () => {
    expect(await answer(true)).toBe(true);
    expect(useSearchHistoryStore.getState().entries).toEqual([]);
  });
});
