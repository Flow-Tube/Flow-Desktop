import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { CardByline } from "./CardMeta";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const host = document.createElement("div");

function render(views: string | null, published: string | null) {
  act(() => {
    root ??= createRoot(host);
    root.render(createElement(CardByline, { views, published, className: "line" }));
  });
  return host.firstElementChild as HTMLElement;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe("CardByline", () => {
  it("puts a dot between the views and the date", () => {
    expect(render("1.2M views", "3 days ago").textContent).toBe("1.2M\u00A0views•3\u00A0days\u00A0ago");
  });

  it("lets the line wrap only after the dot", () => {
    const line = render("1.2M views", "3 days ago");
    expect(line.querySelectorAll("wbr")).toHaveLength(1);
    expect(line.querySelector("wbr")?.previousSibling?.textContent).toBe("•");
  });

  it("drops the dot when only one part is known", () => {
    expect(render("1.2M views", null).textContent).toBe("1.2M\u00A0views");
    expect(render(null, "3 days ago").querySelector("wbr")).toBeNull();
    expect(render(null, null).textContent).toBe("");
  });
});
