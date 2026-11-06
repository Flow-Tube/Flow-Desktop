import { describe, expect, it } from "vitest";
import { SponsorBlockTracker, seekBarSegments, segmentAction, showsSkipButton, skipsAutomatically } from "./sponsorBlockPolicy";
import type { SponsorBlockSegment } from "./api/foss";
import type { SponsorBlockAction } from "../store/useSettingsStore";

const seg = (UUID: string, category: string, start: number, end: number, actionType?: string): SponsorBlockSegment => ({
  UUID,
  category,
  segment: [start, end],
  actionType,
});
const sponsor = (action: SponsorBlockAction) => ({ sponsor: action });

describe("sponsorBlock actions", () => {
  it("mutes a mute-type segment where the category would skip it", () => {
    expect(segmentAction(seg("a", "sponsor", 0, 1, "mute"), sponsor("skip"))).toBe("mute");
    expect(segmentAction(seg("a", "sponsor", 0, 1, "mute"), sponsor("skip_once"))).toBe("mute");
    expect(segmentAction(seg("a", "sponsor", 0, 1, "mute"), sponsor("notify"))).toBe("notify");
    expect(segmentAction(seg("a", "sponsor", 0, 1, "skip"), sponsor("skip"))).toBe("skip");
  });

  it("matches Android's table", () => {
    expect(skipsAutomatically("skip", true)).toBe(true);
    expect(skipsAutomatically("skip_once", false)).toBe(true);
    expect(skipsAutomatically("skip_once", true)).toBe(false);
    expect(skipsAutomatically("skip_button", false)).toBe(false);
    for (const action of ["skip_button", "notify", "mute"] as const) expect(showsSkipButton(action, false)).toBe(true);
    for (const action of ["skip", "ignore", "disabled"] as const) expect(showsSkipButton(action, false)).toBe(false);
    expect(showsSkipButton("skip_once", false)).toBe(false);
    expect(showsSkipButton("skip_once", true)).toBe(true);
  });

  it("leaves disabled categories off the seek bar and keeps ignored ones", () => {
    const list = [seg("a", "sponsor", 0, 1), seg("b", "intro", 2, 3)];
    expect(seekBarSegments(list, { sponsor: "disabled", intro: "ignore" }).map((s) => s.UUID)).toEqual(["b"]);
  });
});

describe("SponsorBlockTracker", () => {
  const segment = seg("a", "sponsor", 10, 20);

  it("skips once per pass, and again after a rewind", () => {
    const t = new SponsorBlockTracker();
    expect(t.tick(12, [segment], sponsor("skip"), false).skip).toBe(segment);
    expect(t.tick(12, [segment], sponsor("skip"), false).skip).toBeNull();
    t.tick(5, [segment], sponsor("skip"), false);
    expect(t.tick(11, [segment], sponsor("skip"), false).skip).toBe(segment);
  });

  it("skip once offers the button after a rewind instead of skipping", () => {
    const t = new SponsorBlockTracker();
    expect(t.tick(12, [segment], sponsor("skip_once"), false).skip).toBe(segment);
    t.tick(5, [segment], sponsor("skip_once"), false);
    const back = t.tick(11, [segment], sponsor("skip_once"), false);
    expect(back.skip).toBeNull();
    expect(back.manual).toBe(segment);
  });

  it("does nothing for ignore and disabled", () => {
    for (const action of ["ignore", "disabled"] as const) {
      expect(new SponsorBlockTracker().tick(12, [segment], sponsor(action), false)).toEqual({
        skip: null, mute: null, muteStarted: null, notify: null, manual: null,
      });
    }
  });

  it("holds a mute through the segment, counts it once, and offers a skip", () => {
    const t = new SponsorBlockTracker();
    const first = t.tick(12, [segment], sponsor("mute"), false);
    expect(first).toMatchObject({ mute: segment, muteStarted: segment, manual: segment });
    expect(t.tick(13, [segment], sponsor("mute"), false)).toMatchObject({ mute: segment, muteStarted: null });
    expect(t.tick(25, [segment], sponsor("mute"), false).mute).toBeNull();
  });

  it("notifies once and shows the button while inside", () => {
    const t = new SponsorBlockTracker();
    expect(t.tick(12, [segment], sponsor("notify"), false)).toMatchObject({ notify: segment, manual: segment });
    expect(t.tick(13, [segment], sponsor("notify"), false)).toMatchObject({ notify: null, manual: segment });
  });

  it("hides the button once used, until a rewind past the segment", () => {
    const t = new SponsorBlockTracker();
    t.tick(12, [segment], sponsor("skip_button"), false);
    t.dismiss("a");
    expect(t.tick(13, [segment], sponsor("skip_button"), false).manual).toBeNull();
    t.tick(5, [segment], sponsor("skip_button"), false);
    expect(t.tick(11, [segment], sponsor("skip_button"), false).manual).toBe(segment);
  });

  it("shows nothing once playback ended", () => {
    expect(new SponsorBlockTracker().tick(12, [segment], sponsor("skip_button"), true).manual).toBeNull();
  });

  it("leaves a segment alone when SponsorBlock comes back on inside it", () => {
    const t = new SponsorBlockTracker();
    t.leaveAlone(12, [segment]);
    expect(t.tick(13, [segment], sponsor("skip"), false).skip).toBeNull();
    expect(t.tick(13, [segment], sponsor("mute"), false).mute).toBeNull();
    t.tick(5, [segment], sponsor("skip"), false);
    expect(t.tick(11, [segment], sponsor("skip"), false).skip).toBe(segment);
  });

  describe("highlight", () => {
    const point = seg("h", "poi_highlight", 300, 300);
    const actions = { poi_highlight: "skip_button", sponsor: "skip" } as const;

    it("offers the jump for 10 seconds from the start and no longer", () => {
      const t = new SponsorBlockTracker();
      expect(t.tick(0, [point], actions, false).manual).toBe(point);
      expect(t.tick(9.9, [point], actions, false).manual).toBe(point);
      expect(t.tick(10, [point], actions, false).manual).toBeNull();
    });

    it("counts the 10 seconds after an opening skip", () => {
      const intro = seg("s", "sponsor", 0, 30);
      const t = new SponsorBlockTracker();
      expect(t.tick(35, [intro, point], actions, false).manual).toBe(point);
      expect(t.tick(41, [intro, point], actions, false).manual).toBeNull();
    });

    it("stays hidden on Show in seek bar", () => {
      expect(new SponsorBlockTracker().tick(0, [point], { poi_highlight: "ignore" }, false).manual).toBeNull();
    });

    it("never offers a jump backwards", () => {
      const near = seg("n", "poi_highlight", 5, 5);
      expect(new SponsorBlockTracker().tick(6, [near], { poi_highlight: "skip_button" }, false).manual).toBeNull();
    });
  });
});
