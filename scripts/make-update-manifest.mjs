#!/usr/bin/env node
/*
 * RELEASE STEP: write latest.json, the file the Windows app's "Install the update" reads
 * (src/data/selfUpdate.ts, tauri-plugin-updater; Guy, 2026-11-08).
 *
 * The app asks https://github.com/<repo>/releases/latest/download/latest.json which version is newest,
 * downloads the installer it names and installs it ONLY when the installer's signature matches the
 * pubkey in src-tauri/tauri.conf.json. A latest.json that names the wrong file, the wrong version or a
 * signature from another key is worse than none: every player's click fails. So this script refuses to
 * write one unless the signature really verifies against that pubkey — the same minisign check the
 * updater runs (prehashed BLAKE2b-512 + Ed25519, then the trusted-comment signature).
 *
 *   node scripts/make-update-manifest.mjs --exe "<…>/bundle/nsis/Heroes Heaven_0.1.46_x64-setup.exe" --out <release folder>
 *
 * `npx tauri build --ci` writes the installer and its `.sig` beside it when the build had
 * TAURI_SIGNING_PRIVATE_KEY (the key lives outside the repo, in %USERPROFILE%\.tauri). The release
 * uploads the installer as Heroes-Heaven-Setup.exe — the same bytes, so the signature still holds — and
 * latest.json names that file under the version's own tag. Exit 1 with the reason on any refusal.
 * test/update-button.test.tsx.
 */
import { createHash, createPublicKey, verify } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = 'guybirinbom-hub/Heroes-Heaven';
/** The stable asset name the release uploads (src/data/updateCheck.ts WINDOWS_ASSET). */
export const WINDOWS_ASSET = 'Heroes-Heaven-Setup.exe';

/* DER prefix of an Ed25519 SubjectPublicKeyInfo; the 32 raw key bytes follow it. */
const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');

function lines(b64) {
  return Buffer.from(String(b64).trim(), 'base64')
    .toString('utf8')
    .split(/\r?\n/)
    .filter((l) => l.length > 0);
}

/**
 * Does `sigB64` (the content of a tauri `.sig` file) sign `file` with the key in `pubkeyB64` (the
 * tauri.conf.json pubkey)? Returns { ok: true } or { ok: false, why }.
 */
export function verifyMinisign(file, sigB64, pubkeyB64) {
  const fail = (why) => ({ ok: false, why });
  let pub, sig;
  try {
    pub = lines(pubkeyB64);
    sig = lines(sigB64);
  } catch {
    return fail('the key or the signature is not base64');
  }
  if (pub.length < 2) return fail('the public key is not a minisign key');
  const pk = Buffer.from(pub[1], 'base64');
  if (pk.length !== 42 || pk.subarray(0, 2).toString('latin1') !== 'Ed') return fail('the public key is not a minisign key');
  if (sig.length < 4) return fail('the signature file is not a minisign signature');
  const box = Buffer.from(sig[1], 'base64');
  if (box.length !== 74) return fail('the signature file is not a minisign signature');
  const alg = box.subarray(0, 2).toString('latin1');
  if (!box.subarray(2, 10).equals(pk.subarray(2, 10))) return fail('the installer was signed with a different key than the one in tauri.conf.json');
  const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI, pk.subarray(10)]), format: 'der', type: 'spki' });
  let message;
  if (alg === 'ED') message = createHash('blake2b512').update(file).digest();
  else if (alg === 'Ed') message = file;
  else return fail(`unknown signature kind ${JSON.stringify(alg)}`);
  const signature = box.subarray(10);
  if (!verify(null, message, key, signature)) return fail('the signature does not match this file (the file changed after signing, or it is another file)');
  const TRUSTED = 'trusted comment: ';
  if (!sig[2].startsWith(TRUSTED)) return fail('the signature file has no trusted comment');
  const global = Buffer.from(sig[3], 'base64');
  const signedComment = Buffer.concat([signature, Buffer.from(sig[2].slice(TRUSTED.length), 'utf8')]);
  if (!verify(null, signedComment, key, global)) return fail('the signature file’s trusted comment was changed');
  return { ok: true };
}

/** The latest.json body tauri-plugin-updater reads. */
export function buildManifest({ version, signature, pubDate, notes = '' }) {
  return {
    version,
    notes,
    pub_date: pubDate,
    platforms: {
      'windows-x86_64': {
        signature: signature.trim(),
        url: `https://github.com/${REPO}/releases/download/v${version}/${WINDOWS_ASSET}`,
      },
    },
  };
}

/**
 * Everything the CLI does, minus the write: refuse or return the manifest.
 * `conf` is the parsed tauri.conf.json (version + plugins.updater.pubkey).
 */
export function makeManifest({ exePath, conf, now = new Date(), notes = '' }) {
  const version = conf?.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('tauri.conf.json has no x.y.z version');
  const pubkey = conf?.plugins?.updater?.pubkey;
  if (typeof pubkey !== 'string' || !pubkey.trim()) throw new Error('tauri.conf.json has no plugins.updater.pubkey');
  if (!existsSync(exePath)) throw new Error(`no installer at ${exePath}`);
  if (!basename(exePath).includes(`_${version}_`)) {
    throw new Error(`the installer ${basename(exePath)} is not version ${version} (an old build?)`);
  }
  const sigPath = `${exePath}.sig`;
  if (!existsSync(sigPath)) {
    throw new Error(`no ${basename(sigPath)} beside the installer: build with TAURI_SIGNING_PRIVATE_KEY set`);
  }
  const signature = readFileSync(sigPath, 'utf8');
  if (!signature.trim()) throw new Error(`${basename(sigPath)} is empty`);
  const check = verifyMinisign(readFileSync(exePath), signature, pubkey);
  if (!check.ok) throw new Error(check.why);
  return buildManifest({ version, signature, pubDate: now.toISOString(), notes });
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main() {
  const exePath = arg('--exe');
  const out = arg('--out');
  if (!exePath || !out) {
    console.error('usage: node scripts/make-update-manifest.mjs --exe <setup.exe> --out <folder> [--notes <file>]');
    process.exit(1);
  }
  const notesFile = arg('--notes');
  try {
    const conf = JSON.parse(readFileSync(join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
    const notes = notesFile ? readFileSync(notesFile, 'utf8').trim() : '';
    const manifest = makeManifest({ exePath, conf, notes });
    mkdirSync(out, { recursive: true });
    const target = join(out, 'latest.json');
    writeFileSync(target, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`wrote ${target}: version ${manifest.version}, signature verified against tauri.conf.json`);
  } catch (e) {
    console.error(`REFUSED: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
