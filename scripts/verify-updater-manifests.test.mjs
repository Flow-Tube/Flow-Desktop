import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyManifests, verifyUpdaterSignature } from "./verify-updater-manifests.mjs";

// Made with `tauri signer sign --app-version 1.2.3-nightly.7` (CLI 2.12.4) and a
// throwaway key, so the check is proven against the CLI's real output.
const DATA = Buffer.from("flow updater test\n");
const PUBLIC_KEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEY3QThENTFFNTg2REE1ODkKUldTSnBXMVlIdFdvOXpHNE9jWGZ2Tnpld1NNSmFGUFZDbWxxL0QvMWthaEF6WXpjVVZhbFJqQmcK";
const SIGNATURE =
  "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTSnBXMVlIdFdvOTdUaUZHY0kvYWdTcENoS05URFZyYzN3MXNBNkN5R0RtcVJ3Z1FaR01EV2RPUXR3K1Bha3JHMEc0U3BlQXI1QXh6RlhINkhpZ3VVMXZDM2lVM1RsVVF3PQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzk0NjY4NDg3CWZpbGU6cGtnLmJpbgl2ZXJzaW9uOjEuMi4zLW5pZ2h0bHkuNwpzQ01zQlJpQU1FMDRmclkrV0JqZVBnOXQwRmZPWWh2SU96QWJpUnh2YlNRUW04QXh4WXNNTTllZ1RKc0tROERkVHgwZDJKeUUrK0tmYndZZ01SWUJCQT09Cg==";
// The nightly public key: same format, another key.
const OTHER_KEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEUyOTkzMDMzODkzOTgxMDYKUldRR2dUbUpNekNaNG9VVU5FUXUrQUZXU0NpSGJLNHkzZFpzTjMrWXFqUXI1SzRDSkpBTzdDaXkK";

function decoded(base64) {
  return Buffer.from(base64, "base64").toString("utf8");
}

function encoded(text) {
  return Buffer.from(text, "utf8").toString("base64");
}

describe("updater signatures", () => {
  it("accepts the CLI's signature and returns the version it binds", () => {
    expect(verifyUpdaterSignature({ data: DATA, signature: SIGNATURE, publicKey: PUBLIC_KEY })).toBe(
      "1.2.3-nightly.7",
    );
  });

  it("rejects a changed file", () => {
    const data = Buffer.from("flow updater test!\n");
    expect(() => verifyUpdaterSignature({ data, signature: SIGNATURE, publicKey: PUBLIC_KEY })).toThrow(
      /file signature does not verify/,
    );
  });

  it("rejects a signature made with another key", () => {
    expect(() => verifyUpdaterSignature({ data: DATA, signature: SIGNATURE, publicKey: OTHER_KEY })).toThrow(
      /signed with another key/,
    );
  });

  it("rejects an edited version in the trusted comment", () => {
    const edited = encoded(decoded(SIGNATURE).replace("version:1.2.3-nightly.7", "version:1.2.3-nightly.8"));
    expect(() => verifyUpdaterSignature({ data: DATA, signature: edited, publicKey: PUBLIC_KEY })).toThrow(
      /trusted comment signature does not verify/,
    );
  });
});

describe("updater manifests", () => {
  let folder;
  afterEach(() => folder && rmSync(folder, { recursive: true, force: true }));

  function manifests(version, asset = "pkg.bin") {
    folder = mkdtempSync(join(tmpdir(), "updater-"));
    writeFileSync(join(folder, "pkg.bin"), DATA);
    return {
      "latest.json": {
        version,
        platforms: {
          "windows-x86_64": {
            signature: SIGNATURE,
            url: `https://github.com/Flow-Tube/Flow-Desktop/releases/download/nightly/${asset}`,
          },
        },
      },
    };
  }

  it("verifies each entry against the downloaded file", () => {
    const list = manifests("1.2.3-nightly.7");
    const checked = verifyManifests({ folder, manifests: list, publicKey: PUBLIC_KEY });
    expect(checked).toEqual(["latest.json windows-x86_64 (pkg.bin)"]);
  });

  it("refuses a signature bound to another version than the manifest announces", () => {
    const list = manifests("1.2.3-nightly.9");
    expect(() => verifyManifests({ folder, manifests: list, publicKey: PUBLIC_KEY })).toThrow(
      /signed for 1\.2\.3-nightly\.7, manifest announces 1\.2\.3-nightly\.9/,
    );
  });

  it("refuses an entry whose file is missing", () => {
    const list = manifests("1.2.3-nightly.7", "other.bin");
    expect(() => verifyManifests({ folder, manifests: list, publicKey: PUBLIC_KEY })).toThrow(/other\.bin/);
  });
});
