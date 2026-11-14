// Plans the signing of the nightly updater packages in a folder, then writes
// their manifests from the signatures: latest.json for Windows and macOS,
// latest-linux.json for Linux (see nightly-version.mjs for why they differ).
// Usage: node scripts/nightly-updater-manifest.mjs plan <folder>
//          prints "<version>\t<file>" for each package to sign
//        node scripts/nightly-updater-manifest.mjs write <folder>
// Env: GITHUB_REPOSITORY (write), GITHUB_RUN_NUMBER, NIGHTLY_NOTES (plain text).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  nightlyDownloadUrl,
  nightlyManifestName,
  nightlyVersion,
} from "./nightly-version.mjs";
import { ARCH, BUNDLE, buildManifests, expectedKeys, readSignatures } from "./updater-manifest.mjs";

const PACKAGE = /^Flow-Nightly_[^_]+_(windows|macos|linux)-(x64|arm64)(-setup\.exe|\.app\.tar\.gz|\.deb|\.rpm|\.AppImage)$/;
const OS = { windows: "windows", macos: "darwin", linux: "linux" };

const EXPECTED = {
  "latest.json": expectedKeys(["windows", "darwin"]),
  "latest-linux.json": expectedKeys(["linux"]),
};

/**
 * Returns every updater package in `files` with its manifest entry. The
 * installed app refuses a package signed for another version than its
 * manifest announces, so each one is signed for its manifest's version.
 */
export function nightlyPackages({ files, repository, runNumber, baseVersion }) {
  return files
    .filter((name) => PACKAGE.test(name))
    .map((file) => {
      const [, os, arch, suffix] = PACKAGE.exec(file);
      const platform = OS[os];
      return {
        file,
        manifest: nightlyManifestName(platform),
        version: nightlyVersion(baseVersion, runNumber, platform),
        platform,
        arch: ARCH[arch],
        bundle: BUNDLE[suffix],
        url: nightlyDownloadUrl(repository, file),
      };
    });
}

/** Returns `{ [fileName]: manifest }`. Every package must be signed. */
export function buildNightlyManifests({ files, signatures, repository, runNumber, baseVersion, notes, pubDate }) {
  return buildManifests({
    packages: nightlyPackages({ files, repository, runNumber, baseVersion }),
    signatures,
    notes,
    pubDate,
    expected: EXPECTED,
  });
}

function main(mode, folder) {
  const repository = process.env.GITHUB_REPOSITORY;
  const runNumber = process.env.GITHUB_RUN_NUMBER;
  if (!["plan", "write"].includes(mode) || !folder || !runNumber || (mode === "write" && !repository)) {
    throw new Error("usage: GITHUB_REPOSITORY=… GITHUB_RUN_NUMBER=… nightly-updater-manifest.mjs plan|write <folder>");
  }
  const files = readdirSync(folder);
  const baseVersion = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version;

  if (mode === "plan") {
    const packages = nightlyPackages({ files, repository, runNumber, baseVersion });
    if (packages.length === 0) throw new Error(`no updater packages in ${folder}`);
    for (const { file, version } of packages) console.log(`${version}\t${file}`);
    return;
  }

  const manifests = buildNightlyManifests({
    files,
    signatures: readSignatures(files, (name) => readFileSync(join(folder, name), "utf8")),
    repository,
    runNumber,
    baseVersion,
    notes: process.env.NIGHTLY_NOTES ?? "",
    pubDate: new Date().toISOString(),
  });
  for (const [file, manifest] of Object.entries(manifests)) {
    writeFileSync(join(folder, file), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Wrote ${file} for ${manifest.version}: ${Object.keys(manifest.platforms).join(", ")}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2], process.argv[3]);
}
