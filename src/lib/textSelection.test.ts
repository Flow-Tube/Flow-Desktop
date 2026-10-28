import { afterEach, describe, expect, it } from "vitest";
import {
  hasTextSelection,
  selectedText,
  selectionSearchQuery,
  selectionTouches,
  shortSelectionLabel,
} from "./textSelection";

function select(node: Node, start: number, end: number) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("text selection", () => {
  it("reports nothing for a collapsed caret", () => {
    document.body.innerHTML = "<p>Hello world</p>";
    select(document.querySelector("p")!.firstChild!, 3, 3);
    expect(selectedText()).toBe("");
    expect(hasTextSelection()).toBe(false);
  });

  it("returns the highlighted text trimmed", () => {
    document.body.innerHTML = "<p>Hello world</p>";
    select(document.querySelector("p")!.firstChild!, 5, 11);
    expect(selectedText()).toBe("world");
    expect(hasTextSelection()).toBe(true);
  });

  it("treats a highlight of only whitespace as no highlight", () => {
    document.body.innerHTML = "<p>Hello world</p>";
    select(document.querySelector("p")!.firstChild!, 5, 6);
    expect(hasTextSelection()).toBe(false);
  });

  it("knows which element the highlight touches", () => {
    document.body.innerHTML = '<div id="chat"><p>first</p></div><div id="other"><p>second</p></div>';
    select(document.querySelector("#chat p")!.firstChild!, 0, 5);
    expect(selectionTouches(document.getElementById("chat"))).toBe(true);
    expect(selectionTouches(document.getElementById("other"))).toBe(false);
    expect(selectionTouches(null)).toBe(false);
  });

  it("turns a passage into a one-line query capped at 100 characters", () => {
    expect(selectionSearchQuery("  lo-fi\n\n beats \t to study ")).toBe("lo-fi beats to study");
    expect(selectionSearchQuery("a".repeat(150))).toHaveLength(100);
  });

  it("shortens long queries for the menu label", () => {
    expect(shortSelectionLabel("short")).toBe("short");
    expect(shortSelectionLabel("x".repeat(40))).toBe(`${"x".repeat(30)}…`);
  });
});
