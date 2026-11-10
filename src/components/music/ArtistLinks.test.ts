import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ArtistLinks } from "./ArtistLinks";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

const artists = [
  { name: "DIVINE", id: "UC-divine" },
  { name: "Jonita Gandhi", id: "UC-jonita" },
  { name: "Guest", id: null },
];

describe("ArtistLinks", () => {
  let host: HTMLDivElement;
  let root: Root;
  const rowPlay = vi.fn();

  const renderInRow = (plain = false) => {
    act(() => {
      root.render(
        createElement(
          "div",
          {
            role: "button",
            onClick: rowPlay,
            onKeyDown: (event: KeyboardEvent) => {
              event.preventDefault();
              rowPlay();
            },
          },
          createElement(ArtistLinks, { artists, plain }),
        ),
      );
    });
  };

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it("opens the clicked artist without playing the row", () => {
    renderInRow();
    const buttons = host.querySelectorAll("button");
    expect(Array.from(buttons, (b) => b.textContent)).toEqual(["DIVINE", "Jonita Gandhi"]);

    act(() => buttons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(mockNavigate).toHaveBeenCalledWith("/music/artist/UC-jonita");
    expect(rowPlay).not.toHaveBeenCalled();
  });

  it("keeps Enter on an artist away from the row", () => {
    renderInRow();
    const button = host.querySelector("button");
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });

    act(() => button?.dispatchEvent(enter));

    expect(rowPlay).not.toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(false);
  });

  it("shows plain text while rows are being selected", () => {
    renderInRow(true);
    expect(host.querySelector("button")).toBeNull();
    expect(host.textContent).toBe("DIVINE, Jonita Gandhi, Guest");
  });

  it("marks each name for its own text direction", () => {
    renderInRow();
    const names = host.querySelectorAll("[dir=auto]");
    expect(Array.from(names, (n) => n.textContent)).toEqual(["DIVINE", "Jonita Gandhi", "Guest"]);
  });
});
