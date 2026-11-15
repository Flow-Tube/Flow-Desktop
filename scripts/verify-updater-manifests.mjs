// Checks every entry of the updater manifests in a folder the way an installed
// app does: the signature must verify against the public key, and the version
// it was signed for must be the version the manifest announces.
// Usage: node scripts/verify-updater-manifests.mjs <folder> <public key file>
// The key file holds the base64 public key, as tauri.conf.json stores it.
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, createPublicKey, verify } from "node:crypto";

// DER prefix that turns a raw 32-byte Ed25519 key into an SPKI key.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function decodeLines(base64) {
  return Buffer.from(base64.trim(), "base64").toString("utf8").trim().split("\n");
}

function decodePublicKey(base64) {
  const raw = Buffer.from(decodeLines(base64)[1] ?? "", "base64");
  if (raw.length !== 42 || raw.subarray(0, 2).toString() !== "Ed") {
    throw new Error("not a minisign public key");
  }
  return {
    keyId: raw.subarray(2, 10),
    key: createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw.subarray(10)]),
      format: "der",
      type: "spki",
    }),
  };
}

/**
 * Verifies a Tauri updater signature (base64 of a minisign signature file)
 * over `data` and returns the version it was signed for, or null when the
 * signature names none. Throws when it doesn't verify.
 */
export function verifyUpdaterSignature({ data, signature, publicKey }) {
  const { keyId, key } = decodePublicKey(publicKey);
  const [, signatureLine, trustedLine, globalLine] = decodeLines(signature);
  const raw = Buffer.from(signatureLine ?? "", "base64");
  if (raw.length !== 74) throw new Error("not a minisign signature");
  if (!raw.subarray(2, 10).equals(keyId)) throw new Error("signed with another key");

  const algorithm = raw.subarray(0, 2).toString();
  // "ED" signs the file's BLAKE2b-512 hash, which is what the Tauri CLI writes.
  if (algorithm !== "ED") throw new Error(`unexpected signature algorithm ${algorithm}`);
  const digest = createHash("blake2b512").update(data).digest();
  if (!verify(null, digest, key, raw.subarray(10))) throw new Error("file signature does not verify");

  const trusted = (trustedLine ?? "").replace(/^trusted comment: /, "");
  const global = Buffer.from(globalLine ?? "", "base64");
  if (!verify(null, Buffer.concat([raw.subarray(10), Buffer.from(trusted)]), key, global)) {
    throw new Error("trusted comment signature does not verify");
  }
  return trusted.split("\t").find((field) => field.startsWith("version:"))?.slice(8) ?? null;
}

/** Verifies every entry of the given manifests against files in `folder`. */
export function verifyManifests({ folder, manifests, publicKey }) {
  const checked = [];
  for (const [file, manifest] of Object.entries(manifests)) {
    const entries = Object.entries(manifest.platforms ?? {});
    if (entries.length === 0) throw new Error(`${file} lists no platforms`);
    for (const [platform, { url, signature }] of entries) {
      const asset = decodeURIComponent(basename(new URL(url).pathname));
      const where = `${file} ${platform} (${asset})`;
      let signed;
      try {
        signed = verifyUpdaterSignature({
          data: readFileSync(join(folder, asset)),
          signature,
          publicKey,
        });
      } catch (error) {
        throw new Error(`${where}: ${error.message}`);
      }
      if (signed !== manifest.version) {
        throw new Error(`${where}: signed for ${signed ?? "no version"}, manifest announces ${manifest.version}`);
      }
      checked.push(where);
    }
  }
  return checked;
}

function main(folder, keyFile) {
  if (!folder || !keyFile) {
    throw new Error("usage: verify-updater-manifests.mjs <folder> <public key file>");
  }
  const names = readdirSync(folder).filter((name) => /^latest.*\.json$/.test(name));
  if (names.length === 0) throw new Error(`no updater manifests in ${folder}`);
  const manifests = Object.fromEntries(
    names.map((name) => [name, JSON.parse(readFileSync(join(folder, name), "utf8"))]),
  );
  const checked = verifyManifests({
    folder,
    manifests,
    publicKey: readFileSync(keyFile, "utf8"),
  });
  for (const line of checked) console.log(`verified ${line}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv[2], process.argv[3]);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
