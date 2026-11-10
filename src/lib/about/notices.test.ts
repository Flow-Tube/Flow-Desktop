import { describe, expect, it } from "vitest";

import { groupNotices } from "./notices";
import entries from "./thirdPartyNotices.json";
import packageJson from "../../../package.json";
import cargoToml from "../../../src-tauri/Cargo.toml?raw";

const listed = new Set((entries as string[][]).map(([name]) => name));
const REGENERATE = "run node scripts/generate-notices.mjs";

/** Dependency names from every `[...dependencies]` table except dev and build ones. */
function cargoDependencies(toml: string): string[] {
  const names: string[] = [];
  let inDependencies = false;
  for (const line of toml.split("\n")) {
    const table = line.match(/^\[(.+)\]$/)?.[1];
    if (table) inDependencies = table.endsWith("dependencies") && !table.includes("dev-") && !table.includes("build-");
    else if (inDependencies) {
      const name = line.match(/^([A-Za-z0-9_-]+)\s*=/)?.[1];
      if (name) names.push(name);
    }
  }
  return names;
}

describe("third-party notices", () => {
  it("list every app dependency", () => {
    expect(Object.keys(packageJson.dependencies).filter((name) => !listed.has(name)), REGENERATE).toEqual([]);
  });

  it("list every backend dependency", () => {
    const names = cargoDependencies(cargoToml);
    expect(names).toContain("tauri");
    expect(names.filter((name) => !listed.has(name)), REGENERATE).toEqual([]);
  });

  it("group projects by licence, largest first", () => {
    expect(
      groupNotices([
        ["a", "1", "MIT"],
        ["b", "2", "Apache-2.0"],
        ["c", "3", "MIT"],
        ["d", "", "BSD-3-Clause"],
      ]),
    ).toEqual([
      { license: "MIT", projects: ["a 1", "c 3"] },
      { license: "Apache-2.0", projects: ["b 2"] },
      { license: "BSD-3-Clause", projects: ["d"] },
    ]);
  });
});
