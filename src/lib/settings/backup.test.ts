import { describe, expect, it } from "vitest";

import { extractBackupCollections, validateSettingsBackup } from "./backup";

describe("restoring a backup's settings", () => {
  it("takes the stored strings a backup file from the backend carries", () => {
    const parsed = validateSettingsBackup({
      schemaVersion: 2,
      settings: { autoplay_enabled: "false", trending_region: "DE", proxy_password: "secret", not_a_setting: "x" },
    });
    expect(parsed?.settings).toMatchObject({ autoplay_enabled: "false", trending_region: "DE" });
    expect(parsed?.settings).not.toHaveProperty("proxy_password");
    expect(parsed?.skippedKeys).toEqual(expect.arrayContaining(["proxy_password", "not_a_setting"]));
  });

  it("keeps reading the typed values of older desktop files", () => {
    const parsed = validateSettingsBackup({ schemaVersion: 2, settings: { autoplay_enabled: false } });
    expect(parsed?.settings).toMatchObject({ autoplay_enabled: "false" });
  });

  it("drops anything in a file that isn't a list of records", () => {
    expect(extractBackupCollections({ collections: { likes: [1], settings: "no" } })).toEqual({ likes: [1] });
    expect(extractBackupCollections({ version: 2 })).toBeNull();
  });
});
