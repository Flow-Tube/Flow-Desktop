// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SponsorBlockSegment } from "./api/foss";
import { useManualSponsorSegment } from "./useManualSponsorSegment";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const segment = { UUID: "u", category: "sponsor", segment: [10, 20] } as SponsorBlockSegment;
let hook: ReturnType<typeof useManualSponsorSegment>;
let root: Root;
function Probe({ identity, active }: { identity: string; active: boolean }) {
  hook = useManualSponsorSegment(identity, active);
  return null;
}
const render = (identity: string, active = true) =>
  act(() => root.render(createElement(Probe, { identity, active })));

beforeEach(() => {
  root = createRoot(document.createElement("div"));
  render("first");
  act(() => hook[1](segment));
});
afterEach(() => act(() => root.unmount()));

describe("useManualSponsorSegment", () => {
  it("keeps the segment while the same source plays", () => {
    render("first");
    expect(hook[0]).toBe(segment);
  });

  it("drops it when the source changes", () => {
    render("second");
    expect(hook[0]).toBeNull();
  });

  it("drops it when SponsorBlock goes off", () => {
    render("first", false);
    expect(hook[0]).toBeNull();
  });
});
