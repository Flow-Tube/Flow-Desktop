import { existsSync, renameSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  console.error("desktop:install est uniquement disponible sur macOS.");
  process.exit(1);
}

const packageManager = process.env.npm_execpath;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const launchedByPackageManager =
  process.env.npm_lifecycle_event === "desktop:install" && packageManager;
const buildCommand = launchedByPackageManager
  ? [packageManager, "desktop:build"]
  : [join(root, "scripts", "run-tauri-local.mjs"), "build"];
const build = spawnSync(process.execPath, buildCommand, {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const source = join(root, "src-tauri", "target", "release", "bundle", "macos", "Flow.app");
const destination = "/Applications/Flow.app";
const staging = "/Applications/.Flow.app.installing";
const backup = "/Applications/.Flow.app.previous";
const bundleIdentifier = "io.github.aedev.flow.desktop";

function runAppleScript(sourceCode) {
  return spawnSync("/usr/bin/osascript", ["-e", sourceCode], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function isFlowRunning() {
  const result = runAppleScript(`application id "${bundleIdentifier}" is running`);
  return result.status === 0 && result.stdout.trim() === "true";
}

if (!existsSync(source)) {
  console.error(`Application compilée introuvable : ${source}`);
  process.exit(1);
}

rmSync(staging, { force: true, recursive: true });
rmSync(backup, { force: true, recursive: true });

const copy = spawnSync("/usr/bin/ditto", [source, staging], { stdio: "inherit" });
if (copy.status !== 0) {
  rmSync(staging, { force: true, recursive: true });
  process.exit(copy.status ?? 1);
}

const reopenAfterInstall = isFlowRunning();
if (reopenAfterInstall) {
  console.log("Fermeture de Flow avant son remplacement…");
  const quit = runAppleScript(`tell application id "${bundleIdentifier}" to quit`);
  if (quit.status !== 0) {
    rmSync(staging, { force: true, recursive: true });
    process.exit(quit.status ?? 1);
  }

  const deadline = Date.now() + 10_000;
  while (isFlowRunning() && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }

  if (isFlowRunning()) {
    console.error("Flow ne s’est pas fermée. Fermez-la manuellement puis relancez la commande.");
    rmSync(staging, { force: true, recursive: true });
    process.exit(1);
  }
}

if (existsSync(destination)) {
  renameSync(destination, backup);
}

try {
  renameSync(staging, destination);
  rmSync(backup, { force: true, recursive: true });
} catch (error) {
  if (existsSync(backup) && !existsSync(destination)) {
    renameSync(backup, destination);
  }
  throw error;
}

console.log(`Flow a été compilée et installée dans ${destination}.`);

if (reopenAfterInstall) {
  const reopen = spawnSync("/usr/bin/open", [destination], { stdio: "inherit" });
  if (reopen.status !== 0) {
    console.error("Flow est installée, mais sa réouverture automatique a échoué.");
    process.exit(reopen.status ?? 1);
  }
  console.log("La nouvelle version de Flow a été rouverte.");
}
