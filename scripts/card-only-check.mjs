/*
 * ONE RENDERER — every record popup draws its page through the card (docs/card-design.md section 2
 * rule 7; check 3 of section 8; step 4 of section 9, REPORT MODE).
 *
 * Lists every file under src/ that, outside src/sheet/RecordCard.tsx (the card) and
 * src/sheet/AstRenderer.tsx (the renderer the card uses):
 *   - renders <AstRenderer>,
 *   - passes astKey to <DescBody> (DescBody's page branch — the legacy path step 22 removes),
 *   - renders <RichText>, or a <DescBody> with no astKey (DescBody's RichText lane), for what may be a
 *     record with a page. Which of those records HAS a page is a runtime fact this static scan cannot
 *     see, so every such call site is listed; each surface's own step decides it.
 * Allowlisted (they never show a record's page): NotesTab (the player's notes), the homebrew editor
 * (HomebrewPage, homebrewSchemas) and ModeDetailModal.
 *
 * REPORT MODE until step 22: it prints the list and exits 0, whatever it finds — today it finds
 * several, and that is expected (each surface moves onto the card in its own step). `--strict` is the
 * step-22 behaviour: exit 1 when anything is listed. Not in `npm run verify` until step W.
 *
 *   node scripts/card-only-check.mjs            # the report
 *   node scripts/card-only-check.mjs --json     # the list as JSON
 *   node scripts/card-only-check.mjs --strict   # step 22: fail on any listed call site
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CARD_FILES = new Set(['src/sheet/RecordCard.tsx', 'src/sheet/AstRenderer.tsx']);
export const ALLOW = new Set(['src/sheet/NotesTab.tsx', 'src/sheet/HomebrewPage.tsx', 'src/sheet/homebrewSchemas.ts', 'src/sheet/ModeDetailModal.tsx']);

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(f)) out.push(p);
  }
  return out;
}

/** The JSX opening element starting at `i` (`<Name …>` or `<Name … />`), braces respected. */
function elementAt(src, i) {
  let depth = 0;
  let q = null;
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (q) { if (c === q && src[j - 1] !== '\\') q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { if (depth > 0 || c !== '`') q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return src.slice(i, j + 1);
  }
  return src.slice(i);
}

/** Every listed call site of one file's text: {kind, line, snippet}. */
export function callSites(rel, src) {
  if (CARD_FILES.has(rel) || ALLOW.has(rel)) return [];
  const out = [];
  const lineOf = (i) => src.slice(0, i).split('\n').length;
  for (const m of src.matchAll(/<(AstRenderer|DescBody|RichText)\b/g)) {
    const el = elementAt(src, m.index);
    const snippet = el.replace(/\s+/g, ' ').slice(0, 140);
    if (m[1] === 'AstRenderer') out.push({ kind: 'AstRenderer', line: lineOf(m.index), snippet });
    else if (m[1] === 'RichText') out.push({ kind: 'RichText', line: lineOf(m.index), snippet });
    else if (/\bastKey\s*=/.test(el)) out.push({ kind: 'DescBody astKey', line: lineOf(m.index), snippet });
    else out.push({ kind: 'DescBody string lane (RichText)', line: lineOf(m.index), snippet });
  }
  return out;
}

export function scan(root = ROOT) {
  const found = [];
  for (const p of walk(join(root, 'src'))) {
    const rel = relative(root, p).replace(/\\/g, '/');
    for (const s of callSites(rel, readFileSync(p, 'utf8'))) found.push({ file: rel, ...s });
  }
  return found.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

const IS_MAIN = process.argv.some((a) => /(^|\/)card-only-check\.mjs$/.test(String(a).replace(/\\/g, '/')));
if (IS_MAIN) {
  const found = scan();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(found, null, 2));
  } else {
    const files = [...new Set(found.map((f) => f.file))];
    const byKind = {};
    for (const f of found) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
    console.log(`card only: ${found.length} call sites outside the card in ${files.length} files (${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(', ')}) — REPORT MODE, expected until each surface moves onto the card.`);
    for (const f of found) console.log(`   ${f.file}:${f.line}  [${f.kind}]  ${f.snippet}`);
  }
  if (process.argv.includes('--strict') && found.length) process.exitCode = 1;
}
