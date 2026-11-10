import { describe, expect, it, vi } from "vitest";

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
const { descriptionTags } = await import("./DescriptionTags");

describe("descriptionTags", () => {
  it("sorts without regard to case, puts the category first and drops repeats", () => {
    expect(descriptionTags(["banana", "Apple", "banana"], "Music")).toEqual(["Music", "Apple", "banana"]);
    expect(descriptionTags(["Music", "a"], "Music")).toEqual(["a", "Music"]);
    expect(descriptionTags(undefined, null)).toEqual([]);
  });
});
