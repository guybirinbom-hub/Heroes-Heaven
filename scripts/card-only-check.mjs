/*
 * ONE RENDERER — every record popup draws its page through the card (docs/card-design.md section 2
 * rule 7; check 3 of section 8). STRICT since card step 22 (section 9 row 22): it exits 1 when it lists
 * anything. Until step 22 it only reported, while each surface moved onto the card in its own step;
 * step 22 removed the per-surface switches and the legacy paths they guarded, and this check keeps them
 * removed. Not in `npm run verify` until step W.
 *
 * Listed (each one fails the check), for every file under src/:
 *   - <AstRenderer> rendered outside the card's files WITHOUT the card's walk (`card=`): a page drawn
 *     neither by RecordCard nor through the card walk (the spell card in SpellsTab draws its tree with
 *     `card={cardWalk}`, section 9 rows 16-17) — the pre-card HostPage and DescBody's page branch were such;
 *   - `hideMeta` passed to <AstRenderer>, or declared by AstRenderer.tsx: the held-record popup body every
 *     'mine' card replaced (removed in step 22);
 *   - astKey / astId passed to <DescBody>, or declared by DescBody.tsx, or DescBody.tsx rendering
 *     <AstRenderer> / reading useAstNode: DescBody's page branch (removed in step 22) — DescBody is the
 *     card's no-page lane (section 7), never a page;
 *   - <RichText> rendered outside the card's files (DescBody is the card's text lane);
 *   - a <DescBody> text lane in a file that is not the card's and not a named no-page lane (NO_PAGE_LANES,
 *     each with the reason it never holds a record's page). A new text lane must be named there, with its
 *     reason, or move onto the card.
 * Allowlisted (they never show a record's page): NotesTab (the player's notes), the homebrew editor
 * (HomebrewPage, homebrewSchemas) and ModeDetailModal.
 *
 *   node scripts/card-only-check.mjs            # the check (exit 1 on anything listed)
 *   node scripts/card-only-check.mjs --json     # the list as JSON (same exit code)
 * (`--strict`, the step-4 spelling of the check, is still accepted and changes nothing.)
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** The card: RecordCard, the renderer it draws pages with, and DescBody — its no-page text lane. */
export const CARD_FILES = new Set(['src/sheet/RecordCard.tsx', 'src/sheet/AstRenderer.tsx', 'src/sheet/DescBody.tsx']);
export const ALLOW = new Set(['src/sheet/NotesTab.tsx', 'src/sheet/HomebrewPage.tsx', 'src/sheet/homebrewSchemas.ts', 'src/sheet/ModeDetailModal.tsx']);
/** Files whose <DescBody> text lanes never hold a record's page, each with why (docs/card-design.md section 7). */
export const NO_PAGE_LANES = {
  'src/sheet/SpellsTab.tsx':
    "the spell card's string lane — a spell kept on src/data/heighten-string-lane.json, or one with no spell page (section 7, \"Spells kept on the string lane\"), its Heightened entries on that lane — and the spell notes (ours)",
  'src/sheet/MainTab.tsx':
    'an action that names no record (NoRecordActionDetail: Recover, Retrain, an item activation) — no page exists for it; every action that names its record opens its card',
};

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

/** The source with its comments blanked (line numbers and string literals kept), so a comment naming a
 *  removed prop is not code — and a "//" inside a string ("https://…") is not a comment. */
export function codeOf(src) {
  let out = '';
  let q = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      out += c;
      if (c === '\\') { out += src[i + 1] ?? ''; i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? src.length : end;
      out += ' '.repeat(stop - i);
      i = stop - 1;
      continue;
    }
    out += c;
  }
  return out;
}

/** Every listed call site of one file's text: {kind, line, snippet}. */
export function callSites(rel, src) {
  if (ALLOW.has(rel)) return [];
  const code = codeOf(src);
  const out = [];
  const lineOf = (i) => code.slice(0, i).split('\n').length;
  const card = CARD_FILES.has(rel);
  for (const m of code.matchAll(/<(AstRenderer|DescBody|RichText)\b/g)) {
    const el = elementAt(code, m.index);
    const snippet = el.replace(/\s+/g, ' ').slice(0, 140);
    const at = { line: lineOf(m.index), snippet };
    if (m[1] === 'AstRenderer') {
      if (/\bhideMeta\b/.test(el)) out.push({ kind: 'AstRenderer hideMeta', ...at });
      else if (!card && !/\bcard\s*=/.test(el)) out.push({ kind: 'AstRenderer outside the card', ...at });
    } else if (m[1] === 'RichText') {
      if (!card) out.push({ kind: 'RichText outside the card', ...at });
    } else if (/\bast(?:Key|Id)\s*=/.test(el)) {
      out.push({ kind: 'DescBody astKey', ...at });
    } else if (!card && !NO_PAGE_LANES[rel]) {
      out.push({ kind: 'DescBody text lane outside the card', ...at });
    }
  }
  // The two legacy paths step 22 removed, at their source: DescBody's page branch and AstRenderer's hideMeta
  // — matched only in code shape (a prop, a destructure, a read, a call), so prose that names them is not code.
  if (rel === 'src/sheet/DescBody.tsx') {
    for (const m of code.matchAll(/<AstRenderer\b|\buseAstNode\s*\(|\bast(?:Key|Id)\s*(?:[?:=,})]|&&)/g)) {
      out.push({ kind: 'DescBody page branch', line: lineOf(m.index), snippet: m[0] });
    }
  }
  if (rel === 'src/sheet/AstRenderer.tsx') {
    for (const m of code.matchAll(/\bhideMeta\s*(?:[?:=,})]|&&)/g)) out.push({ kind: 'AstRenderer hideMeta', line: lineOf(m.index), snippet: m[0] });
  }
  return out;
}

export function scan(root = ROOT) {
  const found = [];
  for (const p of walk(join(root, 'src'))) {
    const rel = relative(root, p).replace(/\\/g, '/');
    for (const s of callSites(rel, readFileSync(p, 'utf8'))) found.push({ file: rel, ...s });
  }
  // A named no-page lane whose file is gone is a stale entry: the list only names what exists.
  for (const rel of Object.keys(NO_PAGE_LANES)) {
    if (!existsSync(join(root, rel))) found.push({ file: rel, kind: 'stale NO_PAGE_LANES entry', line: 0, snippet: '' });
  }
  return found.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

const IS_MAIN = process.argv.some((a) => /(^|\/)card-only-check\.mjs$/.test(String(a).replace(/\\/g, '/')));
if (IS_MAIN) {
  const found = scan();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(found, null, 2));
  } else if (!found.length) {
    console.log(`card only: every record page is drawn by the card (${Object.keys(NO_PAGE_LANES).length} named no-page text lanes: ${Object.keys(NO_PAGE_LANES).join(', ')}).`);
  } else {
    const files = [...new Set(found.map((f) => f.file))];
    const byKind = {};
    for (const f of found) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
    console.log(`card only: ${found.length} call sites outside the card in ${files.length} files (${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(', ')}) — each one fails the check.`);
    for (const f of found) console.log(`   ${f.file}:${f.line}  [${f.kind}]  ${f.snippet}`);
  }
  if (found.length) process.exitCode = 1;
}
