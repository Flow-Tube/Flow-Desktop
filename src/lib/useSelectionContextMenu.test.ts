import { afterEach, describe, expect, it } from "vitest";
import { selectionMenuFor } from "./useSelectionContextMenu";

function highlight(node: Node, start: number, end: number) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

const rightClick = (target: Node | null, defaultPrevented = false) => ({
  target,
  defaultPrevented,
  clientX: 40,
  clientY: 60,
});

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("selectionMenuFor", () => {
  it("opens at the pointer with the highlighted text", () => {
    document.body.innerHTML = "<p>Never gonna give you up</p><button>Card</button>";
    const paragraph = document.querySelector("p")!;
    const selection = highlight(paragraph.firstChild!, 6, 11);
    expect(selectionMenuFor(rightClick(paragraph), selection)).toEqual({
      anchor: { top: 60, left: 40 },
      text: "gonna",
    });
  });

  it("stays closed away from the highlight", () => {
    document.body.innerHTML = "<p>Never gonna give you up</p><button>Card</button>";
    const selection = highlight(document.querySelector("p")!.firstChild!, 6, 11);
    expect(selectionMenuFor(rightClick(document.querySelector("button")), selection)).toBeNull();
  });

  it("leaves right-clicks a card menu already claimed", () => {
    document.body.innerHTML = "<p>Never gonna give you up</p>";
    const paragraph = document.querySelector("p")!;
    const selection = highlight(paragraph.firstChild!, 6, 11);
    expect(selectionMenuFor(rightClick(paragraph, true), selection)).toBeNull();
  });

  it("stays closed with nothing highlighted", () => {
    document.body.innerHTML = "<p>Never gonna give you up</p>";
    const paragraph = document.querySelector("p")!;
    const selection = highlight(paragraph.firstChild!, 2, 2);
    expect(selectionMenuFor(rightClick(paragraph), selection)).toBeNull();
  });
});
