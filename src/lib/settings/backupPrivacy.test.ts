import { describe, expect, it } from "vitest";
import { SETTING_DEFINITIONS, SETTING_EXPORT_KEYS } from "./schema";

const rustSource = Object.values(
  import.meta.glob("/src-tauri/src/backup/mod.rs", { query: "?raw", import: "default", eager: true }),
)[0] as string;

const privateKeys = SETTING_DEFINITIONS.filter((definition) => definition.exportScope === "private")
  .map((definition) => definition.key as string)
  .sort();

describe("what a backup may hold", () => {
  it("never lists a private setting for export", () => {
    for (const key of privateKeys) expect(SETTING_EXPORT_KEYS).not.toContain(key);
  });

  it("includes the proxy credentials among the private settings", () => {
    expect(privateKeys).toEqual(expect.arrayContaining(["proxy_username", "proxy_password"]));
  });

  it("matches the backend's list of what never enters a file", () => {
    const block = rustSource.match(/pub const NEVER_BACKED_UP: \[&str; \d+\] = \[([\s\S]*?)\];/);
    if (!block?.[1]) throw new Error("NEVER_BACKED_UP not found in backup/mod.rs");
    const rust = [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "").sort();
    expect(rust).toEqual(privateKeys);
  });
});
