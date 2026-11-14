// Plans the signing of a release's updater packages in a folder, then writes
// latest.json from the signatures, as installed apps read it from
// releases/latest.
// Usage: node scripts/release-updater-manifest.mjs plan <folder>
//          prints "<version>\t<file>" for each package to sign
//        node scripts/release-updater-manifest.mjs write <folder>
// Env: RELEASE_VERSION, RELEASE_TAG, GITHUB_REPOSITORY (write),
//      RELEASE_APP_NOTES (plain text, write).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ARCH, BUNDLE, buildManifests, expectedKeys, readSignatures } from "./updater-manifest.mjs";

// The names earlier releases used, which download links and the AUR
// PKGBUILDs depend on.
const PACKAGE = /^Flow_(.+)_(windows|darwin|linux)_(x64|amd64|x86_64|arm64|aarch64)(-setup\.exe|\.app\.tar\.gz|\.deb|\.rpm|\.AppImage)$/;
const EXPECTED = { "latest.json": expectedKeys(["windows", "darwin", "linux"]) };

export function releaseDownloadUrl(repository, tag, asset) {
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`;
}

/** Returns every updater package in `files` with its latest.json entry. */
export function releasePackages({ files, version, tag, repository }) {
  return files
    .filter((name) => PACKAGE.test(name))
    .map((file) => {
      const [, fileVersion, platform, arch, suffix] = PACKAGE.exec(file);
      if (fileVersion !== version) throw new Error(`${file} is not version ${version}`);
      return {
        file,
        manifest: "latest.json",
        version,
        platform,
        arch: ARCH[arch],
        bundle: BUNDLE[suffix],
        url: releaseDownloadUrl(repository, tag, file),
      };
    });
}

export function buildReleaseManifest({ files, signatures, version, tag, repository, notes, pubDate }) {
  return buildManifests({
    packages: releasePackages({ files, version, tag, repository }),
    signatures,
    notes,
    pubDate,
    expected: EXPECTED,
  })["latest.json"];
}

function main(mode, folder) {
  const { RELEASE_VERSION: version, RELEASE_TAG: tag, GITHUB_REPOSITORY: repository } = process.env;
  if (!["plan", "write"].includes(mode) || !folder || !version || !tag || (mode === "write" && !repository)) {
    throw new Error("usage: RELEASE_VERSION=… RELEASE_TAG=… GITHUB_REPOSITORY=… release-updater-manifest.mjs plan|write <folder>");
  }
  const files = readdirSync(folder);

  if (mode === "plan") {
    const packages = releasePackages({ files, version, tag, repository: repository ?? "" });
    if (packages.length === 0) throw new Error(`no updater packages in ${folder}`);
    for (const { file } of packages) console.log(`${version}\t${file}`);
    return;
  }

  const manifest = buildReleaseManifest({
    files,
    signatures: readSignatures(files, (name) => readFileSync(join(folder, name), "utf8")),
    version,
    tag,
    repository,
    notes: process.env.RELEASE_APP_NOTES ?? "",
    pubDate: new Date().toISOString(),
  });
  writeFileSync(join(folder, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote latest.json for ${manifest.version}: ${Object.keys(manifest.platforms).join(", ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2], process.argv[3]);
}
