import { describe, expect, it } from "vitest";
import { collaboratorsByline } from "./collaborators";

const channel = (name: string) => ({ channelId: `UC${name}`, name });

describe("collaboratorsByline", () => {
  it("names two channels and counts the rest", () => {
    expect(collaboratorsByline([channel("KSI"), channel("MrBeast")])).toBe("KSI and MrBeast");
    expect(collaboratorsByline([channel("CNET"), channel("A"), channel("B"), channel("C"), channel("D")])).toBe(
      "CNET and 4 more",
    );
    expect(collaboratorsByline([])).toBe("");
  });
});
