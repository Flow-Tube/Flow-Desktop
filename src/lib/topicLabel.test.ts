import { describe, expect, it } from "vitest";

import { capitalized, topicLabel } from "./topicLabel";

describe("topicLabel", () => {
  it("shows the spelling titles use for a stemmed key", () => {
    const brain = { display_forms: { "vintag guitar": { form: "Vintage Guitars", votes: 3 } } };
    expect(topicLabel(brain, "vintag guitar")).toBe("Vintage Guitars");
  });

  it("drops the domain tag before looking the key up", () => {
    const brain = { display_forms: { metal: { form: "Metal", votes: 1 } } };
    expect(topicLabel(brain, "metal:music")).toBe("Metal");
  });

  it("capitalizes a key no title has spelled", () => {
    expect(topicLabel({}, "claude 5.5")).toBe("Claude 5.5");
    expect(capitalized("iPhone")).toBe("iPhone");
  });
});
