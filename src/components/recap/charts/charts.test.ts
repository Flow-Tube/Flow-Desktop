import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BarStrip } from "./BarStrip";
import { CalendarChart } from "./CalendarChart";
import { ClockChart } from "./ClockChart";
import { SplitBar } from "./SplitBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function render(element: ReturnType<typeof createElement>) {
  act(() => root.render(element));
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** A bar's height from its path: the baseline minus where its top sits. */
function barHeight(path: Element): number {
  const top = /V([\d.]+)Q/.exec(path.getAttribute("d") ?? "");
  return 120 - Number(top?.[1]) + 4;
}

describe("BarStrip", () => {
  const props = { labels: ["a", "b", "c"], format: String, ariaLabel: "bars" };

  it("draws bars to scale and no bar at zero", () => {
    render(createElement(BarStrip, { ...props, values: [10, 0, 5] }));
    const bars = host.querySelectorAll("path");
    expect(bars).toHaveLength(2);
    expect(barHeight(bars[0]!)).toBeCloseTo(120);
    expect(barHeight(bars[1]!)).toBeCloseTo(60);
  });

  it("draws nothing but the baseline when every value is zero", () => {
    render(createElement(BarStrip, { ...props, values: [0, 0, 0] }));
    expect(host.querySelectorAll("path")).toHaveLength(0);
    expect(host.querySelector("line")).not.toBeNull();
  });

  it("reads a hovered bar out in place of the caption", () => {
    render(createElement(BarStrip, { ...props, values: [10, 0, 5], caption: "busiest" }));
    expect(host.querySelector("p")?.textContent).toBe("busiest");
    const slots = host.querySelectorAll("rect");
    act(() => {
      slots[2]!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(host.querySelector("p")?.textContent).toBe("c · 5");
  });
});

describe("ClockChart", () => {
  it("lengthens each spoke with its hour and names the busiest", () => {
    const hours = Array.from({ length: 24 }, () => 0);
    hours[21] = 8;
    hours[9] = 4;
    render(createElement(ClockChart, { hourCounts: hours, ariaLabel: "clock" }));
    const spokes = [...host.querySelectorAll("line")].filter((line) => line.getAttribute("stroke") !== "transparent");
    expect(spokes).toHaveLength(2);
    const length = (line: Element) =>
      Math.hypot(
        Number(line.getAttribute("x2")) - Number(line.getAttribute("x1")),
        Number(line.getAttribute("y2")) - Number(line.getAttribute("y1")),
      );
    expect(length(spokes[0]!) / length(spokes[1]!)).toBeCloseTo(0.5);
    expect(host.textContent).toContain("9 PM");
  });
});

describe("CalendarChart", () => {
  it("starts on the month's own weekday and deepens with time", () => {
    render(createElement(CalendarChart, { month: "2026-09", dayMs: { "2026-09-01": 100, "2026-09-02": 200 }, ariaLabel: "calendar" }));
    const cells = [...host.querySelectorAll("rect")];
    // 30 days, plus one overlay for each active day. 2026-09-01 is a Tuesday.
    expect(cells).toHaveLength(32);
    expect(cells[0]!.getAttribute("x")).toBe("32");
    expect(Number(cells[3]!.getAttribute("fill-opacity"))).toBe(1);
    expect(Number(cells[1]!.getAttribute("fill-opacity"))).toBeCloseTo(0.6);
  });
});

describe("SplitBar", () => {
  it("gives each part its share of the width and lists it with its value", () => {
    render(
      createElement(SplitBar, {
        shares: [
          { label: "Videos", value: 300, fill: "fill-primary", swatch: "bg-primary" },
          { label: "Music", value: 100, fill: "fill-chrome-neutral-400", swatch: "bg-chrome-neutral-400" },
        ],
        format: String,
        ariaLabel: "split",
      }),
    );
    const parts = host.querySelectorAll("rect");
    expect(Number(parts[0]!.getAttribute("width")) / Number(parts[1]!.getAttribute("width"))).toBeCloseTo(3);
    expect(host.textContent).toContain("Videos300");
  });
});
