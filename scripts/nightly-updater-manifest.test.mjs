import { describe, expect, it } from "vitest";
import { buildNightlyManifests } from "./nightly-updater-manifest.mjs";
import { nightlyVersion } from "./nightly-version.mjs";

const V = "0.1.0-nightly.812";
const PACKAGES = [
  `Flow-Nightly_${V}_windows-x64-setup.exe`,
  `Flow-Nightly_${V}_windows-arm64-setup.exe`,
  `Flow-Nightly_${V}_macos-x64.app.tar.gz`,
  `Flow-Nightly_${V}_macos-arm64.app.tar.gz`,
  `Flow-Nightly_${V}_linux-x64.deb`,
  `Flow-Nightly_${V}_linux-x64.rpm`,
  `Flow-Nightly_${V}_linux-x64.AppImage`,
  `Flow-Nightly_${V}_linux-arm64.deb`,
  `Flow-Nightly_${V}_linux-arm64.rpm`,
  `Flow-Nightly_${V}_linux-arm64.AppImage`,
];
const FILES = [...PACKAGES, `Flow-Nightly_${V}_macos-x64.dmg`, `Flow-Nightly_${V}_macos-arm64.dmg`, "SHA256SUMS"];

function build(signatures) {
  return buildNightlyManifests({
    files: FILES,
    signatures,
    repository: "Flow-Tube/Flow-Desktop",
    runNumber: "812",
    baseVersion: "0.1.0-beta4",
    notes: "notes",
    pubDate: "2026-11-13T00:00:00.000Z",
  });
}

const signed = () => Object.fromEntries(PACKAGES.map((name) => [name, `sig of ${name}\n`]));

describe("nightly updater manifests", () => {
  it("splits Windows and macOS from Linux, each with its own version form", () => {
    const manifests = build(signed());
    expect(Object.keys(manifests).sort()).toEqual(["latest-linux.json", "latest.json"]);
    expect(manifests["latest.json"].version).toBe("0.1.0-nightly.812");
    expect(manifests["latest-linux.json"].version).toBe("0.1.0+nightly.812");
    expect(Object.keys(manifests["latest.json"].platforms).sort()).toEqual([
      "darwin-aarch64",
      "darwin-aarch64-app",
      "darwin-x86_64",
      "darwin-x86_64-app",
      "windows-aarch64",
      "windows-aarch64-nsis",
      "windows-x86_64",
      "windows-x86_64-nsis",
    ]);
  });

  it("points the plain Linux key at the AppImage and each format at its package", () => {
    const { platforms } = build(signed())["latest-linux.json"];
    const appimage = `Flow-Nightly_${V}_linux-x64.AppImage`;
    expect(platforms["linux-x86_64"]).toEqual(platforms["linux-x86_64-appimage"]);
    expect(platforms["linux-x86_64"]).toEqual({
      signature: `sig of ${appimage}`,
      url: `https://github.com/Flow-Tube/Flow-Desktop/releases/download/nightly/${appimage}`,
    });
    expect(platforms["linux-aarch64-rpm"].url).toMatch(/linux-arm64\.rpm$/);
    expect(platforms["linux-aarch64-deb"].url).toMatch(/linux-arm64\.deb$/);
  });

  it("leaves the manifests out of an unsigned build", () => {
    expect(build({})).toBeNull();
  });

  it("refuses a build signed only in part", () => {
    const signatures = signed();
    delete signatures[`Flow-Nightly_${V}_linux-arm64.rpm`];
    expect(() => build(signatures)).toThrow(/unsigned updater packages: .*linux-arm64\.rpm/);
  });

  it("refuses a manifest without every platform", () => {
    const signatures = signed();
    delete signatures[`Flow-Nightly_${V}_macos-arm64.app.tar.gz`];
    expect(() =>
      buildNightlyManifests({
        files: FILES.filter((name) => !name.endsWith("macos-arm64.app.tar.gz")),
        signatures,
        repository: "Flow-Tube/Flow-Desktop",
        runNumber: "812",
        baseVersion: "0.1.0",
        notes: "",
        pubDate: "",
      }),
    ).toThrow(/latest\.json is missing darwin-aarch64/);
  });
});

describe("nightly versions", () => {
  it("drops the base pre-release and keeps the run number in both forms", () => {
    expect(nightlyVersion("0.1.0-beta4", 9, "win32")).toBe("0.1.0-nightly.9");
    expect(nightlyVersion("0.1.0-beta4", 10, "linux")).toBe("0.1.0+nightly.10");
    expect(nightlyVersion("0.2.0", 10, "darwin")).toBe("0.2.0-nightly.10");
  });
});
