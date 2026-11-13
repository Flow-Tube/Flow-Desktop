// Writes the nightly updater manifests from the signed packages in a folder:
// latest.json for Windows and macOS, latest-linux.json for Linux (see
// nightly-version.mjs for why they differ).
// Usage: node scripts/nightly-updater-manifest.mjs <folder>
// Env: GITHUB_REPOSITORY, GITHUB_RUN_NUMBER, NIGHTLY_NOTES (plain text).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  nightlyDownloadUrl,
  nightlyManifestName,
  nightlyVersion,
} from "./nightly-version.mjs";

const PACKAGE = /^Flow-Nightly_[^_]+_(windows|macos|linux)-(x64|arm64)(-setup\.exe|\.app\.tar\.gz|\.deb|\.rpm|\.AppImage)$/;
const OS = { windows: "windows", macos: "darwin", linux: "linux" };
const ARCH = { x64: "x86_64", arm64: "aarch64" };
const BUNDLE = {
  "-setup.exe": "nsis",
  ".app.tar.gz": "app",
  ".deb": "deb",
  ".rpm": "rpm",
  ".AppImage": "appimage",
};
// The bundle a plain <os>-<arch> key points at, for installs whose bundle type
// the updater can't tell.
const DEFAULT_BUNDLE = { windows: "nsis", darwin: "app", linux: "appimage" };

const EXPECTED = {
  "latest.json": ["windows-x86_64", "windows-aarch64", "darwin-x86_64", "darwin-aarch64"],
  "latest-linux.json": ["linux-x86_64", "linux-aarch64"].flatMap((key) => [
    key,
    `${key}-deb`,
    `${key}-rpm`,
    `${key}-appimage`,
  ]),
};

/**
 * Returns `{ [fileName]: manifest }`, or null when nothing is signed (a build
 * without the signing key, which then can't update itself).
 */
export function buildNightlyManifests({
  files,
  signatures,
  repository,
  runNumber,
  baseVersion,
  notes,
  pubDate,
}) {
  const packages = files.filter((name) => PACKAGE.test(name));
  const signed = packages.filter((name) => signatures[name]);
  if (signed.length === 0) return null;
  const unsigned = packages.filter((name) => !signatures[name]);
  if (unsigned.length > 0) {
    throw new Error(`unsigned updater packages: ${unsigned.join(", ")}`);
  }

  const manifests = {};
  for (const name of packages) {
    const [, os, arch, suffix] = PACKAGE.exec(name);
    const platform = OS[os];
    const file = nightlyManifestName(platform);
    manifests[file] ??= {
      version: nightlyVersion(baseVersion, runNumber, platform),
      notes,
      pub_date: pubDate,
      platforms: {},
    };
    const key = `${platform}-${ARCH[arch]}`;
    const entry = {
      signature: signatures[name].trim(),
      url: nightlyDownloadUrl(repository, name),
    };
    manifests[file].platforms[`${key}-${BUNDLE[suffix]}`] = entry;
    if (BUNDLE[suffix] === DEFAULT_BUNDLE[platform]) manifests[file].platforms[key] = entry;
  }

  for (const [file, keys] of Object.entries(EXPECTED)) {
    const missing = keys.filter((key) => !manifests[file]?.platforms[key]);
    if (missing.length > 0) throw new Error(`${file} is missing ${missing.join(", ")}`);
  }
  return manifests;
}

function main(folder) {
  const repository = process.env.GITHUB_REPOSITORY;
  const runNumber = process.env.GITHUB_RUN_NUMBER;
  if (!folder || !repository || !runNumber) {
    throw new Error("usage: GITHUB_REPOSITORY=… GITHUB_RUN_NUMBER=… nightly-updater-manifest.mjs <folder>");
  }
  const files = readdirSync(folder);
  const signatures = Object.fromEntries(
    files
      .filter((name) => files.includes(`${name}.sig`))
      .map((name) => [name, readFileSync(join(folder, `${name}.sig`), "utf8")]),
  );
  const manifests = buildNightlyManifests({
    files,
    signatures,
    repository,
    runNumber,
    baseVersion: JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version,
    notes: process.env.NIGHTLY_NOTES ?? "",
    pubDate: new Date().toISOString(),
  });
  if (!manifests) {
    console.log("No signed packages: the updater manifests are left out.");
    return;
  }
  for (const [file, manifest] of Object.entries(manifests)) {
    writeFileSync(join(folder, file), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Wrote ${file} for ${manifest.version}: ${Object.keys(manifest.platforms).join(", ")}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]);
}
