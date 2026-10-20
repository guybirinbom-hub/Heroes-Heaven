/*
 * THE FEAT-READERS SCAN — case D of docs/overrides-redesign.md spec item 2 (Building blocks item 9), the
 * guard of work/tweaks-part-a-notes/tweaks-part-a-caseD-plan.md section 5.
 *
 * A feat given through Tweaks (`overrides.addedFeats`) must work exactly like the same feat picked in a
 * slot. About forty readers once walked `build.featPicks` alone, so a given feat reached the feat list and
 * nothing else (Flexible Spellcaster Dedication given to a cleric changed nothing). Every reader of the
 * feats a build holds now asks src/rules/heldFeats.ts (heldFeatSlots / heldFeatIds / featIdAtSlot). This
 * scan finds every place that still names the raw stores, so a NEW walker cannot quietly read
 * `featPicks` alone again, and nothing but the stored reader (src/rules/blocks/stored.ts) and the storage
 * code reads `addedFeats` raw.
 *
 * It walks every src/**\/*.ts(x) file with the TypeScript compiler API (never a regex: a regex cannot tell
 * a type from a read). A HIT is:
 *   - a property access `x.featPicks` / `x?.featPicks` (a write `b.featPicks[k] = id` is one too);
 *   - an element access `x['featPicks']`;
 *   - a destructuring `const { featPicks } = b` / `{ featPicks: fp }`, or a shorthand `{ ...b, featPicks }`;
 *   - a string literal `'featPicks'` (a key list such as SLOT_KEYED).
 * Not a hit: anything inside a type (an interface, a type alias, `BuildState['featPicks']`, a literal
 * type), a comment, an object literal's plain key (`featPicks: {}`), or a longer name (`featPicksOf`).
 * The same scan runs for `addedFeats`.
 *
 * Each hit is keyed `<file>#<enclosing symbol chain>` — the named functions, classes, methods, variables
 * and function-valued object keys around it, outermost first (`src/builder/Builder.tsx#Builder>noSlot`),
 * `<module>` at the top level — and counted. src/rules/heldFeats.ts is exempt by name: it is the home.
 *
 * The allowlist is src/rules/blocks/feat-readers.json; the pure rule that compares the two is
 * `checkFeatReaders` in src/rules/blocks/check.ts; scripts/blocks-check.mjs (npm run verify) runs both.
 */
import ts from 'typescript';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The raw stores whose readers the scan lists. */
export const FEAT_READER_FIELDS = ['featPicks', 'addedFeats'];
/** The one file that may read both freely: the helper itself. */
export const FEAT_READERS_HOME = 'src/rules/heldFeats.ts';
/** The allowlist, repo-relative. */
export const FEAT_READERS_ALLOW = 'src/rules/blocks/feat-readers.json';

/** Is this node inside a type (an interface, a type alias, any type annotation or type argument)? */
function inType(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isTypeNode(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) return true;
    // An expression statement, a function body … ends the search: no type sits above a statement.
    if (ts.isBlock(n) || ts.isSourceFile(n)) return false;
  }
  return false;
}

const isFunctionLike = (n) => !!n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n));

/** The name a node contributes to the symbol chain, or undefined. */
function symbolName(n) {
  if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isFunctionExpression(n) || ts.isClassExpression(n)) && n.name) return n.name.text;
  if (ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n) || ts.isPropertyDeclaration(n)) {
    return n.name && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name) || ts.isPrivateIdentifier(n.name)) ? n.name.text : undefined;
  }
  if (ts.isConstructorDeclaration(n)) return 'constructor';
  if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text;
  if (ts.isPropertyAssignment(n) && isFunctionLike(n.initializer) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))) return n.name.text;
  if (ts.isModuleDeclaration(n) && n.name && ts.isIdentifier(n.name)) return n.name.text;
  return undefined;
}

/** `Outer>inner>innermost` for the symbols around a node; `<module>` when there are none. A node that
 *  is itself the declaration's NAME (a binding pattern) is inside that declaration's parent chain only. */
function symbolChain(node) {
  const names = [];
  for (let n = node.parent; n; n = n.parent) {
    const name = symbolName(n);
    if (name) names.unshift(name);
  }
  return names.length ? names.join('>') : '<module>';
}

/** The text of a string-like literal, or undefined. */
const literalText = (n) => (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : undefined);

/**
 * One file's hits: `{ field, chain, line }[]`, in source order. `path` decides TSX parsing only.
 */
export function scanText(path, text, fields = FEAT_READER_FIELDS) {
  if (!fields.some((f) => text.includes(f))) return [];
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const watched = new Set(fields);
  const out = [];
  const hit = (field, node) => {
    if (inType(node)) return;
    out.push({ field, chain: symbolChain(node), line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
  };
  const visit = (n) => {
    if (ts.isPropertyAccessExpression(n) && watched.has(n.name.text)) hit(n.name.text, n);
    else if (ts.isElementAccessExpression(n) && watched.has(literalText(n.argumentExpression))) hit(literalText(n.argumentExpression), n);
    else if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent)) {
      // `{ featPicks }` or `{ featPicks: fp }` — the store's name is the property name when one is given.
      const prop = n.propertyName ?? n.name;
      const name = ts.isIdentifier(prop) ? prop.text : literalText(prop);
      if (watched.has(name)) hit(name, n);
    } else if (ts.isShorthandPropertyAssignment(n) && watched.has(n.name.text)) hit(n.name.text, n);
    else if (watched.has(literalText(n))) {
      // A literal that is an element access's key was counted with the access.
      const p = n.parent;
      if (!(p && ts.isElementAccessExpression(p) && p.argumentExpression === n)) hit(literalText(n), n);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/**
 * The hits of a set of files, grouped: `{ field, key, count, lines }[]` with `key` =
 * `<path>#<chain>` and `lines` the source lines (for the message). FEAT_READERS_HOME is skipped.
 */
export function scanFeatReaders(files, fields = FEAT_READER_FIELDS) {
  const groups = new Map();
  for (const f of files) {
    const path = f.path.replace(/\\/g, '/');
    if (path === FEAT_READERS_HOME) continue;
    for (const h of scanText(path, f.text, fields)) {
      const key = `${path}#${h.chain}`;
      const id = `${h.field}\u0000${key}`;
      const g = groups.get(id) ?? { field: h.field, key, count: 0, lines: [] };
      g.count++;
      g.lines.push(h.line);
      groups.set(id, g);
    }
  }
  return [...groups.values()];
}

/** Every .ts / .tsx file under `<root>/src`, as `{ path: 'src/…', text }`. */
export function srcFiles(root) {
  return readdirSync(join(root, 'src'), { recursive: true })
    .map((f) => String(f).replace(/\\/g, '/'))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.d.ts'))
    .map((f) => ({ path: `src/${f}`, text: readFileSync(join(root, 'src', f), 'utf8') }));
}

/** The allowlist of a tree, parsed; null when the file is missing; throws on bad JSON. */
export function readAllow(root) {
  const p = join(root, FEAT_READERS_ALLOW);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}
