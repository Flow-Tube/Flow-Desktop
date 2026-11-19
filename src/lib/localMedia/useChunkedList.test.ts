// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { useChunkedList } from "./useChunkedList";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Chunk = ReturnType<typeof useChunkedList>;

function mount(listKey: unknown, total: number, memoryKey?: string) {
  let latest!: Chunk;
  const Reader = (props: { listKey: unknown }) => {
    latest = useChunkedList(props.listKey, total, memoryKey);
    return null;
  };
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Reader, { listKey })));
  return {
    get: () => latest,
    rerender: (nextKey: unknown) => act(() => root.render(createElement(Reader, { listKey: nextKey }))),
    unmount: () => act(() => root.unmount()),
  };
}

describe("useChunkedList", () => {
  it("opens on the first chunk and grows as the last row shown comes near", () => {
    const list = mount("all", 1500);
    expect(list.get().count).toBe(120);
    act(() => list.get().onLastVisible(40));
    expect(list.get().count).toBe(120);
    act(() => list.get().onLastVisible(85));
    expect(list.get().count).toBe(240);
  });

  it("never shows more than the list holds", () => {
    expect(mount("all", 30).get().count).toBe(30);
  });

  it("starts over when the list changes", () => {
    const list = mount("all", 1500);
    act(() => list.get().onLastVisible(100));
    list.rerender("group");
    expect(list.get().count).toBe(120);
  });

  it("remembers how far a list was opened across an unmount, for the same list only", () => {
    const first = mount("all", 1500, "page");
    act(() => first.get().onLastVisible(100));
    act(() => first.get().onLastVisible(220));
    expect(first.get().count).toBe(360);
    first.unmount();

    expect(mount("all", 1500, "page").get().count).toBe(360);
    expect(mount("group", 1500, "page").get().count).toBe(120);
    expect(mount("all", 1500).get().count).toBe(120);
  });
});
