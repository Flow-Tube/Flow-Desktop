import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getString } from "../../lib/i18n/index";
import { DescriptionSummary } from "./DescriptionSummary";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("DescriptionSummary", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    root = createRoot(host);
  });
  afterEach(() => act(() => root.unmount()));

  const render = (expanded: boolean, summary: Parameters<typeof DescriptionSummary>[0]["summary"]) =>
    act(() => root.render(createElement(DescriptionSummary, { summary, expanded })));

  it("shows the first paragraph folded and every paragraph open, always with YouTube's warning", async () => {
    const summary = { title: "AI-generated video summary", disclaimer: "Double-check it.", paragraphs: ["One.", "Two."] };
    await render(false, summary);
    expect(host.textContent).toContain("One.");
    expect(host.textContent).not.toContain("Two.");
    expect(host.textContent).toContain("Double-check it.");
    await render(true, summary);
    expect(host.textContent).toContain("Two.");
  });

  it("says it is AI-written even when YouTube sends no label", async () => {
    await render(true, { paragraphs: ["Text."] });
    expect(host.textContent).toContain(getString("description_ai_summary"));
    expect(host.textContent).toContain(getString("description_ai_summary_warning"));
  });
});
