import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SegmentedControl } from "./SegmentedControl";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SegmentedControl", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const options = [
    { value: "a", label: "Option A" },
    { value: "b", label: "Option B" },
    { value: "c", label: "Option C" },
  ];

  it("renders buttons with radio roles and selection states", () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        createElement(SegmentedControl, {
          value: "b",
          options,
          onChange,
          label: "Test Group",
        }),
      );
    });

    const group = host.querySelector('[role="radiogroup"]');
    expect(group).not.toBeNull();
    expect(group?.getAttribute("aria-label")).toBe("Test Group");

    const radios = host.querySelectorAll('[role="radio"]');
    expect(radios).toHaveLength(3);
    expect(radios[0]?.getAttribute("aria-checked")).toBe("false");
    expect(radios[1]?.getAttribute("aria-checked")).toBe("true");
    expect(radios[2]?.getAttribute("aria-checked")).toBe("false");

    act(() => {
      (radios[2] as HTMLButtonElement).click();
    });
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("distributes options evenly across the container when stretch is enabled", () => {
    act(() => {
      root.render(
        createElement(SegmentedControl, {
          value: "a",
          options,
          onChange: vi.fn(),
          label: "Stretched Group",
          stretch: true,
        }),
      );
    });

    const group = host.querySelector('[role="radiogroup"]');
    expect(group?.className).toContain("flex w-full");

    const radios = host.querySelectorAll('[role="radio"]');
    for (const radio of radios) {
      expect(radio.className).toContain("flex-1");
      expect(radio.className).toContain("justify-center");
    }
  });

  it("keeps compact inline styles when stretch is false", () => {
    act(() => {
      root.render(
        createElement(SegmentedControl, {
          value: "a",
          options,
          onChange: vi.fn(),
          label: "Compact Group",
          stretch: false,
        }),
      );
    });

    const group = host.querySelector('[role="radiogroup"]');
    expect(group?.className).toContain("inline-flex");
    expect(group?.className).not.toContain("flex w-full");

    const radios = host.querySelectorAll('[role="radio"]');
    for (const radio of radios) {
      expect(radio.className).not.toContain("flex-1");
    }
  });
});
