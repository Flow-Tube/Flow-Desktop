import { describe, expect, it } from "vitest";

import type { Profile, ProfilesView } from "../api/profiles";
import { interestChoices } from "./interestChoices";

const profile = (id: string): Profile => ({
  id,
  name: id,
  colorKey: "blue",
  avatar: { kind: "initial", emoji: "", photoVersion: 0 },
  createdAt: 0,
  splashTone: "",
});

const view: ProfilesView = {
  profiles: [profile("home"), profile("kids"), profile("work")],
  photos: {},
  defaultId: "home",
  activeId: "work",
  maxProfiles: 5,
};

describe("interestChoices", () => {
  it("lists the running profile first, then the other profiles that sync", () => {
    const local = [
      { id: "home", link: "link-home" },
      { id: "kids", link: null },
      { id: "work", link: null },
    ];
    expect(interestChoices(view, local).map((p) => p.id)).toEqual(["work", "home"]);
  });

  it("offers only the running profile when nothing else syncs", () => {
    expect(interestChoices(view, []).map((p) => p.id)).toEqual(["work"]);
  });
});
