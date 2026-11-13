import { afterEach, describe, expect, it } from "vitest";
import { alignToEnd, alignToStart, growFromPoint, inlineSign, isRtlText, joinIsolated } from "./direction";

const sources = import.meta.glob<string>(["/src/**/*.{ts,tsx}", "!/src/**/*.test.*"], {
  query: "?raw",
  import: "default",
  eager: true,
});

/*
  Classes that pin something to a physical side, so it stays put when Arabic, Persian or Urdu
  mirror the layout. Use the logical ones instead (start/end, ms/me, ps/pe, text-start,
  rounded-s, border-s), or pair a transform with its rtl: twin.
*/
const PHYSICAL =
  /^(?:[a-z0-9-]+:|\[[^\]]+\]:)*!?-?(?:(?:left|right)-\S+|(?:ml|mr|pl|pr|scroll-ml|scroll-mr|scroll-pl|scroll-pr)-\S+|text-(?:left|right)|rounded-(?:l|r|tl|tr|bl|br)(?:-\S+)?|border-(?:l|r)(?:-\S+)?|translate-x-\S+|origin-(?:left|right|top-left|top-right|bottom-left|bottom-right)|float-(?:left|right)|clear-(?:left|right)|bg-(?:gradient|linear)-to-(?:l|r|tl|tr|bl|br))$/;

/** Files that are left to right on purpose, so physical sides are the right ones there. */
const LEFT_TO_RIGHT_FILES: Record<string, string> = {
  "components/player/Player.tsx": "the video frame is dir=ltr, as Android's player is",
  "components/player/FlowPlayerControls.tsx": "inside the video frame: timeline and transport",
  "components/player/MiniPlayerControls.tsx": "inside the video frame",
  "components/player/HeatmapStrip.tsx": "drawn over the timeline",
  "components/player/gesture/overlay.tsx": "double-tap sides are physical, as on Android",
  "components/player/gesture/SeekFeedback.tsx": "double-tap sides are physical, as on Android",
  "components/player/SponsorBlockSkipButton.tsx": "inside the video frame",
  "components/player/UpNextCard.tsx": "inside the video frame",
  "components/player/AutoplaySwitch.tsx": "inside the video frame",
  "components/watch/FlowPlayerCore.tsx": "its badge renders inside the video frame",
  "components/watch/GlobalVideoPlayer.tsx": "the floating video frame is dir=ltr",
  "components/ui/MediaScrubber.tsx": "a timeline is dir=ltr in every language",
  "components/ui/WindowResizeEdges.tsx": "the window's own edges don't mirror",
  "components/ui/ShelfScroller.tsx": "each arrow sits on the side it scrolls toward and says so",
  "components/music/QueueSwipeRow.tsx": "a swipe shows its action on the side the row leaves",
};

/** Single classes that are physical on purpose, wherever they appear. */
const ALLOWED_TOKENS: Record<string, string> = {
  "translate-x-0": "no offset at all",
  "translate-x-px": "optical centring of a play triangle, which doesn't mirror",
};

/** Physical classes in one file, for a reason given here. */
const ALLOWED_IN_FILE: Record<string, { tokens: string[]; reason: string }> = {
  "components/player/PlayerSettingsMenu.tsx": {
    tokens: ["right-3", "sm:right-5", "origin-bottom-right"],
    reason: "opens over the gear in the left-to-right player, though its rows read in the interface direction",
  },
};

/** `left-1/2 -translate-x-1/2` centres, and a transform beside its rtl: twin already mirrors. */
function excused(token: string, literal: string): boolean {
  const bare = token.replace(/^(?:[a-z0-9-]+:|\[[^\]]+\]:)*!?/, "");
  if ((bare === "left-1/2" || bare === "-translate-x-1/2") && /(^|\s)left-1\/2(\s|$)/.test(literal) && literal.includes("-translate-x-1/2")) {
    return true;
  }
  if (/translate-x|origin-/.test(bare) && /(^|\s)rtl:\S*(translate-x|origin-)/.test(literal)) return true;
  return false;
}

function physicalClasses(): string[] {
  const found: string[] = [];
  for (const [path, source] of Object.entries(sources)) {
    const file = path.replace(/^\/src\//, "");
    if (file in LEFT_TO_RIGHT_FILES) continue;
    for (const match of source.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
      const literal = match[2] ?? "";
      for (const token of literal.split(/\s+|\$\{|[{}]/)) {
        if (!PHYSICAL.test(token) || /(^|:)(rtl|ltr):/.test(token)) continue;
        if (token in ALLOWED_TOKENS || ALLOWED_IN_FILE[file]?.tokens.includes(token) || excused(token, literal)) continue;
        const line = source.slice(0, match.index).split("\n").length;
        found.push(`${file}:${line} ${token}`);
      }
    }
  }
  return found;
}

describe("right-to-left layout", () => {
  it("uses logical sides instead of physical ones", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100);
    expect(physicalClasses()).toEqual([]);
  });
});

describe("direction helpers", () => {
  afterEach(() => {
    document.documentElement.dir = "";
  });

  const button = { left: 100, right: 140 };

  it("anchors popups to the button's end edge and grows from a point toward the end", () => {
    expect(alignToEnd(button)).toEqual({ right: 140 });
    expect(alignToStart(button)).toEqual({ left: 100 });
    expect(growFromPoint(50)).toEqual({ left: 50 });
    expect(inlineSign()).toBe(1);

    document.documentElement.dir = "rtl";
    expect(alignToEnd(button)).toEqual({ left: 100 });
    expect(alignToStart(button)).toEqual({ right: 140 });
    expect(growFromPoint(50)).toEqual({ right: 50 });
    expect(inlineSign()).toBe(-1);
  });

  it("reads a text's direction from its first letter", () => {
    expect(isRtlText("حبيبي love")).toBe(true);
    expect(isRtlText("123 love حبيبي")).toBe(false);
    expect(isRtlText("שלום")).toBe(true);
  });

  it("keeps each joined piece in its own direction and drops empty ones", () => {
    expect(joinIsolated(["@aljazeera", null, "23.8M subscribers", ""])).toBe(
      "\u2068@aljazeera\u2069 • \u206823.8M subscribers\u2069",
    );
    expect(joinIsolated([], " · ")).toBe("");
  });
});
