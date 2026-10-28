import { describe, expect, it } from "vitest";
import {
  PLAYER_MENU_ATTR,
  PLAYER_MENU_OWNER_ATTR,
  PLAYER_VIDEO_LAYER_ATTR,
  classifyPlayerPress,
  dismissForPress,
} from "./playerMenuDismiss";

function mount(html: string) {
  document.body.innerHTML = html;
  return (selector: string) => document.querySelector(selector);
}

describe("classifyPlayerPress", () => {
  it("names the part of the player that was pressed", () => {
    const $ = mount(`
      <div ${PLAYER_MENU_ATTR}><button id="row"><span id="label">Quality</span></button></div>
      <button ${PLAYER_MENU_OWNER_ATTR} id="gear"><svg id="icon"></svg></button>
      <div ${PLAYER_VIDEO_LAYER_ATTR} id="video"></div>
      <button id="play"></button>
    `);
    expect(classifyPlayerPress($("#label"))).toBe("menu");
    expect(classifyPlayerPress($("#icon"))).toBe("owner");
    expect(classifyPlayerPress($("#video"))).toBe("video");
    expect(classifyPlayerPress($("#play"))).toBe("elsewhere");
    expect(classifyPlayerPress(null)).toBe("elsewhere");
  });
});

describe("dismissForPress", () => {
  const both = { settings: true, context: true };

  it("keeps a menu open while it is used", () => {
    expect(dismissForPress("menu", both)).toEqual({ closeSettings: false, closeContext: false });
  });

  it("leaves the settings menu to its own buttons", () => {
    expect(dismissForPress("owner", { settings: true, context: false })).toEqual({ closeSettings: false, closeContext: false });
    expect(dismissForPress("owner", { settings: false, context: true })).toEqual({ closeSettings: false, closeContext: true });
  });

  it("closes whatever is open on any other press", () => {
    expect(dismissForPress("video", both)).toEqual({ closeSettings: true, closeContext: true });
    expect(dismissForPress("elsewhere", { settings: true, context: false })).toEqual({ closeSettings: true, closeContext: false });
  });
});
