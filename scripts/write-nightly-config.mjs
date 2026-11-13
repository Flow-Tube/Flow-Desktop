import { readFileSync, writeFileSync } from "node:fs";
import {
  nightlyDownloadUrl,
  nightlyManifestName,
  nightlyVersion,
} from "./nightly-version.mjs";

const baseConfig = JSON.parse(
  readFileSync("src-tauri/tauri.conf.json", "utf8"),
);
const runNumber = process.env.GITHUB_RUN_NUMBER || String(Date.now());
const version = nightlyVersion(baseConfig.version, runNumber, process.platform);
const baseUpdater = baseConfig.plugins.updater;
// A fork's nightly updates from the fork's own nightly release.
const repository =
  process.env.GITHUB_REPOSITORY ||
  new URL(baseUpdater.endpoints[0]).pathname.split("/").slice(1, 3).join("/");

const nightlyConfig = {
  $schema: "https://schema.tauri.app/config/2",
  productName: "Flow Nightly",
  version,
  identifier: "io.github.aedev.flow.desktop.nightly",
  // Linux packages share /usr/bin, so each channel needs its own binary there.
  // Windows and macOS keep the name their installers and shortcuts expect.
  ...(process.platform === "linux" && {
    mainBinaryName: "flow-desktop-nightly",
  }),
  plugins: {
    updater: {
      endpoints: [
        nightlyDownloadUrl(repository, nightlyManifestName(process.platform)),
      ],
      pubkey: baseUpdater.pubkey,
    },
  },
  bundle: {
    // The publish job signs the packages, so the signing key never reaches the
    // build or its dependencies.
    createUpdaterArtifacts: false,
    shortDescription: "Nightly testing build of Flow Desktop.",
    longDescription:
      "An automatically generated testing build of Flow Desktop. Nightly builds use isolated application data and may be unstable.",
  },
};

writeFileSync(
  "src-tauri/tauri.nightly.generated.json",
  `${JSON.stringify(nightlyConfig, null, 2)}\n`,
);

console.log(`Generated Flow Nightly configuration for version ${version}`);
