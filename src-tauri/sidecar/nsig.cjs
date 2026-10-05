#!/usr/bin/env node
"use strict";

// Flow Desktop — YouTube `n` throttling-parameter solver.
//
// Web-family stream URLs (MWEB/WEB, including their SABR endpoint) carry an
// obfuscated `n` that googlevideo refuses until it is rewritten by the player's
// own JavaScript. Like Flow for Android, this runs the real player script rather
// than re-implementing its transform: the player's URL class, constructed with
// its "deobfuscate" flag, returns the solved `n` from `.get("n")`.
//
// Contract:
//   node nsig.cjs <path to player base.js> <n> [<n> ...]
// stdout: exactly one JSON object:
//   { "success": true,  "results": { "<n>": "<solved n>", ... } }
//   { "success": false, "error": "<message>" }
// Exit code 0 on success, 1 on error.

const fs = require("fs");
const vm = require("vm");

// `jox=function(u){try{var y=(new g.CJ(u,!0)).get("n")…` — the wrapper names the
// URL class whose constructor solves `n` when its second argument is true.
const URL_CLASS_PATTERNS = [
  /[A-Za-z0-9_$]+\s*=\s*function\(([A-Za-z0-9_$]+)\)\s*\{\s*try\s*\{\s*var\s+[A-Za-z0-9_$]+\s*=\s*\(new\s+g\.([A-Za-z0-9_$]+)\(\1\s*,\s*!0\)\)\.get\("n"\)/,
  /\(new\s+g\.([A-Za-z0-9_$]+)\([A-Za-z0-9_$]+\s*,\s*!0\)\)\.get\("n"\)/,
];

function fail(message) {
  process.stdout.write(JSON.stringify({ success: false, error: message }) + "\n");
  process.exit(1);
}

function findUrlClass(source) {
  for (const pattern of URL_CLASS_PATTERNS) {
    const match = source.match(pattern);
    if (match) return match[match.length - 1];
  }
  return null;
}

// The player only touches these at load time; it never needs a working DOM to
// define its classes.
function browserGlobals() {
  const noop = () => {};
  const element = () => ({
    style: {},
    setAttribute: noop,
    appendChild: noop,
    addEventListener: noop,
    removeEventListener: noop,
    getElementsByTagName: () => [],
    querySelector: () => null,
    querySelectorAll: () => [],
    classList: { add: noop, remove: noop, contains: () => false },
  });
  const location = {
    href: "https://www.youtube.com/watch",
    hostname: "www.youtube.com",
    host: "www.youtube.com",
    origin: "https://www.youtube.com",
    protocol: "https:",
    pathname: "/watch",
    search: "",
    hash: "",
  };
  const document = {
    ...element(),
    createElement: element,
    createTextNode: element,
    documentElement: element(),
    body: element(),
    head: element(),
    getElementById: () => null,
    cookie: "",
    location,
    readyState: "complete",
  };
  const window = {
    location,
    document,
    navigator: { userAgent: "Mozilla/5.0", platform: "MacIntel", language: "en-US" },
    setTimeout: noop,
    clearTimeout: noop,
    setInterval: noop,
    clearInterval: noop,
    addEventListener: noop,
    removeEventListener: noop,
    XMLHttpRequest: function () {},
    Image: function () {},
    screen: {},
    history: {},
    performance: { now: () => Date.now() },
    localStorage: null,
    sessionStorage: null,
  };
  window.window = window;
  window.self = window;
  window.top = window;
  window.parent = window;
  return window;
}

function main() {
  const [playerPath, ...challenges] = process.argv.slice(2);
  if (!playerPath || challenges.length === 0) fail("usage: nsig.cjs <base.js> <n> [<n> ...]");

  let source;
  try {
    source = fs.readFileSync(playerPath, "utf8");
  } catch (error) {
    fail(`cannot read player script: ${error.message}`);
  }

  const urlClass = findUrlClass(source);
  if (!urlClass) fail("n-solving URL class not found in player script");

  const context = vm.createContext(browserGlobals());
  try {
    vm.runInContext(`${source}\n;this.__flowPlayer = _yt_player;`, context, { timeout: 10000 });
  } catch (error) {
    // A late initializer can throw after every class is defined; only a missing
    // class below is fatal.
  }
  const UrlClass = context.__flowPlayer && context.__flowPlayer[urlClass];
  if (typeof UrlClass !== "function") fail(`player class ${urlClass} unavailable after load`);

  const results = {};
  for (const n of challenges) {
    try {
      const url = `https://rr1---sn-flow.googlevideo.com/videoplayback?expire=0&n=${encodeURIComponent(n)}`;
      const solved = new UrlClass(url, true).get("n");
      if (typeof solved === "string" && solved.length > 0 && solved !== n) results[n] = solved;
    } catch (error) {
      // Leave the challenge out; the caller treats a missing entry as unsolved.
    }
  }
  if (Object.keys(results).length === 0) fail("no n challenge could be solved");
  process.stdout.write(JSON.stringify({ success: true, results }) + "\n");
}

main();
