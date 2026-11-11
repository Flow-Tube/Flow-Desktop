// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/audio/eq/useEqualizer", () => ({ useEqActive: () => false }));
vi.mock("../../lib/audio/mediaEqEngine", () => ({ videoEqAvailable: () => false }));

const { PlayerSettingsMenu } = await import("./PlayerSettingsMenu");
const { useAppSettingsStore } = await import("../../store/useAppSettingsStore");
const { SETTINGS } = await import("../../lib/settings/schema");
const { getString } = await import("../../lib/i18n/index");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useAppSettingsStore.setState((s) => ({ values: { ...s.values, [SETTINGS.AMBIENT_MODE_ENABLED]: "true" } }));
  host = document.createElement("div");
  root = createRoot(host);
  act(() =>
    root.render(
      createElement(PlayerSettingsMenu, {
        open: true,
        pane: "root",
        onPaneChange: () => {},
        onClose: () => {},
        qualities: [],
        selectedQualityId: "auto",
        isDashPlayback: false,
        captions: [],
        selectedCaptionId: "off",
        setSelectedCaptionId: () => {},
        audioTracks: [],
        setSelectedAudioTrackId: () => {},
        speedOptions: [1],
        speedSliderEnabled: false,
        playbackRate: 1,
        onSelectPlaybackRate: () => {},
      }),
    ),
  );
});
afterEach(() => act(() => root.unmount()));

describe("player settings menu", () => {
  it("leaves autoplay, SponsorBlock and notes to the bar and the page", () => {
    const text = host.textContent ?? "";
    expect(text).not.toContain(getString("player_menu_autoplay"));
    expect(text).not.toContain("SponsorBlock");
    expect(text).not.toContain("Note at");
  });

  it("keeps its switches at the bottom, under the rows that open panes", () => {
    const rows = [...host.querySelector('[role="menu"]')!.querySelectorAll("button, [role='switch']")];
    const switches = rows.filter((row) => row.getAttribute("role") === "switch");
    expect(switches).toHaveLength(2);
    expect(rows.slice(-2)).toEqual(switches);
  });
});
