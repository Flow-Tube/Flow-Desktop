import { describe, expect, it } from "vitest";
import { buildReleaseManifest, releasePackages } from "./release-updater-manifest.mjs";

const V = "0.1.0-beta4";
// The names v0.1.0-beta3 shipped, plus the macOS updater archives.
const PACKAGES = [
  `Flow_${V}_windows_x64-setup.exe`,
  `Flow_${V}_windows_arm64-setup.exe`,
  `Flow_${V}_darwin_x64.app.tar.gz`,
  `Flow_${V}_darwin_aarch64.app.tar.gz`,
  `Flow_${V}_linux_amd64.deb`,
  `Flow_${V}_linux_x86_64.rpm`,
  `Flow_${V}_linux_amd64.AppImage`,
  `Flow_${V}_linux_arm64.deb`,
  `Flow_${V}_linux_aarch64.rpm`,
  `Flow_${V}_linux_aarch64.AppImage`,
];
const FILES = [...PACKAGES, `Flow_${V}_darwin_x64.dmg`, `Flow_${V}_darwin_aarch64.dmg`];
const signed = () => Object.fromEntries(PACKAGES.map((name) => [name, `sig of ${name}\n`]));

function build(signatures, files = FILES) {
  return buildReleaseManifest({
    files,
    signatures,
    version: V,
    tag: `v${V}`,
    repository: "Flow-Tube/Flow-Desktop",
    notes: "notes",
    pubDate: "2026-11-14T00:00:00.000Z",
  });
}

describe("release updater manifest", () => {
  it("lists every platform and bundle under the release version", () => {
    const manifest = build(signed());
    expect(manifest.version).toBe(V);
    expect(manifest.notes).toBe("notes");
    expect(Object.keys(manifest.platforms).sort()).toEqual([
      "darwin-aarch64",
      "darwin-aarch64-app",
      "darwin-x86_64",
      "darwin-x86_64-app",
      "linux-aarch64",
      "linux-aarch64-appimage",
      "linux-aarch64-deb",
      "linux-aarch64-rpm",
      "linux-x86_64",
      "linux-x86_64-appimage",
      "linux-x86_64-deb",
      "linux-x86_64-rpm",
      "windows-aarch64",
      "windows-aarch64-nsis",
      "windows-x86_64",
      "windows-x86_64-nsis",
    ]);
  });

  it("points each key at its file on the tag, the plain Linux key at the AppImage", () => {
    const { platforms } = build(signed());
    const appimage = `Flow_${V}_linux_amd64.AppImage`;
    expect(platforms["linux-x86_64"]).toEqual({
      signature: `sig of ${appimage}`,
      url: `https://github.com/Flow-Tube/Flow-Desktop/releases/download/v${V}/${appimage}`,
    });
    expect(platforms["windows-aarch64"].url).toMatch(/windows_arm64-setup\.exe$/);
    expect(platforms["darwin-x86_64"].url).toMatch(/darwin_x64\.app\.tar\.gz$/);
    expect(platforms["linux-aarch64-rpm"].url).toMatch(/linux_aarch64\.rpm$/);
  });

  it("signs every package for the release version, and skips the disk images", () => {
    const packages = releasePackages({ files: FILES, version: V, tag: `v${V}`, repository: "" });
    expect(packages.map(({ file }) => file).sort()).toEqual([...PACKAGES].sort());
    expect(new Set(packages.map(({ version }) => version))).toEqual(new Set([V]));
  });

  it("refuses a package from another version", () => {
    const files = [...FILES, "Flow_0.1.0-beta3_linux_amd64.deb"];
    expect(() => build(signed(), files)).toThrow(/Flow_0\.1\.0-beta3_linux_amd64\.deb is not version/);
  });

  it("refuses an unsigned package", () => {
    const signatures = signed();
    delete signatures[`Flow_${V}_linux_aarch64.AppImage`];
    expect(() => build(signatures)).toThrow(/unsigned updater packages: .*linux_aarch64\.AppImage/);
  });

  it("refuses a release without every platform", () => {
    const files = FILES.filter((name) => !name.endsWith("windows_arm64-setup.exe"));
    expect(() => build(signed(), files)).toThrow(/latest\.json is missing windows-aarch64, windows-aarch64-nsis/);
  });

  it("refuses two packages for one key", () => {
    const files = [...FILES, `Flow_${V}_linux_x64.deb`];
    const signatures = { ...signed(), [`Flow_${V}_linux_x64.deb`]: "sig" };
    expect(() => build(signatures, files)).toThrow(/two packages for linux-x86_64-deb/);
  });
});
