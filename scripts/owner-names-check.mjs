/*
 * THE OWNER'S OWN CHARACTERS NEVER SHIP IN THIS REPO — it is PUBLIC.
 *
 * 2026-09-17: one of the owner's character names turned up in tracked source files after several
 * releases. This guard is the backstop — it greps every TRACKED file for a small local list of
 * forbidden names and fails the moment one lands, instead of relying on someone noticing.
 *
 * The list lives OUTSIDE git on purpose. `work/owner-names.local.txt` is not tracked (see
 * .gitignore) and must never become tracked — the whole point is to catch a name before it is
 * committed, not to publish the list of names being watched for. Names must never appear in this
 * script or in any other tracked file either; only the local list carries them.
 *
 * If the list file is missing (a clean clone, CI, a machine that never had it) this is a silent
 * no-op: one line, exit 0. So this guard being EARLY in `npm run verify` never blocks anyone who
 * doesn't have the local list.
 *
 * FORMAT — one name per line. `#` starts a comment, blank lines are skipped. A name can carry an
 * allowlist of substrings that would otherwise false-positive under whole-word matching (a hyphen
 * counts as a word boundary, so a short common word can whole-word-match inside a longer hyphenated
 * slug it has nothing to do with), and a PATH SCOPE for a name that is also an ordinary English word
 * and can never be clean everywhere (game rules text will always contain it somewhere):
 *
 *   Example ; paths: test/, src/, scripts/data/, work/ ; allow: some-example-compound, example-suffix-thing
 *
 * `paths:` (comma-separated prefixes, order vs. `allow:` does not matter) restricts that name to
 * tracked files whose repo-relative path starts with one of the prefixes — everywhere else it is
 * not even checked. A name with no `paths:` clause is checked in every tracked file, as before.
 * Any line that matches the name (within scope) AND contains one of its allow terms (case-insensitive
 * substring) is not counted as a hit.
 *
 * SCOPE — `git ls-files` (tracked files only; nothing untracked or gitignored is ever read),
 * skipping node_modules, files over 5 MB, and anything that looks binary (a NUL byte in the first
 * 8 KB read).
 *
 * ENV OVERRIDES (the test uses these — it cannot spin up a git repo or commit a real character
 * name, so it points the script at two throwaway scratch files instead):
 *   HH_OWNER_NAMES  — path to the names list, in place of work/owner-names.local.txt
 *   HH_OWNER_FILES  — path to a newline-separated list of files to scan, in place of `git ls-files`
 *
 *   node scripts/owner-names-check.mjs
 */
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = process.env.HH_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const NAMES_FILE = process.env.HH_OWNER_NAMES || join(ROOT, 'work/owner-names.local.txt');
const MAX_BYTES = 5 * 1024 * 1024;

if (!existsSync(NAMES_FILE)) {
  console.log('owner-names-check: no local list, skipped');
  process.exit(0);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const entries = readFileSync(NAMES_FILE, 'utf8')
  .split(/\r\n|\r|\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((line) => {
    const parts = line.split(';').map((s) => s.trim());
    const name = parts[0];
    if (!name) return null;
    let allow = [];
    let paths = [];
    for (const clause of parts.slice(1)) {
      const mAllow = /^allow\s*:\s*(.+)$/i.exec(clause);
      if (mAllow) { allow = mAllow[1].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean); continue; }
      const mPaths = /^paths\s*:\s*(.+)$/i.exec(clause);
      if (mPaths) paths = mPaths[1].split(',').map((s) => s.trim()).filter(Boolean);
    }
    return { name, re: new RegExp(`\\b${escapeRe(name)}\\b`, 'i'), allow, paths };
  })
  .filter(Boolean);

if (!entries.length) {
  console.log('owner-names-check: local list is empty, skipped');
  process.exit(0);
}

let files;
if (process.env.HH_OWNER_FILES) {
  files = readFileSync(process.env.HH_OWNER_FILES, 'utf8').split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
} else {
  const r = spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error('owner-names-check: `git ls-files` failed:\n' + (r.stderr || ''));
    process.exit(1);
  }
  files = r.stdout.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
}

const hits = [];
for (const rel of files) {
  if (rel.includes('node_modules/')) continue;
  const relNorm = rel.replace(/\\/g, '/');
  // Names with a `paths:` scope are skipped outright for a file outside every one of their prefixes —
  // cheaper than reading the file, and it's most of the names once an ordinary-English-word entry exists.
  const applicable = entries.filter((e) => !e.paths.length || e.paths.some((p) => relNorm.startsWith(p)));
  if (!applicable.length) continue;
  const abs = isAbsolute(rel) ? rel : join(ROOT, rel);
  let st;
  try { st = statSync(abs); } catch { continue; }
  if (!st.isFile() || st.size > MAX_BYTES) continue;
  let buf;
  try { buf = readFileSync(abs); } catch { continue; }
  if (buf.subarray(0, 8192).includes(0)) continue; // looks binary — skip
  const lines = buf.toString('utf8').split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();
    for (const e of applicable) {
      if (!e.re.test(line)) continue;
      if (e.allow.some((a) => lower.includes(a))) continue;
      hits.push(`${rel}:${i + 1}: ${e.name}`);
    }
  }
}

if (!hits.length) {
  console.log(`owner-names-check: ${files.length} tracked file(s) checked, clean`);
  process.exit(0);
}

console.error(`owner-names-check: ${hits.length} hit(s) — an owner character name is in a tracked file:\n`);
for (const h of hits) console.error('  ' + h);
process.exit(1);
