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
 *
 * THE SAME SCAN, a second time, for `overrides` (Tweaks spec item 4, "one reader"; plan B WP2, section 7.1):
 * every read of a character's tweaks goes through src/rules/blocks/active.ts (switch, on/off, start level),
 * so a NEW reader of the raw `overrides` object cannot quietly apply a paused tweak again. The home files
 * (OVERRIDES_READERS_HOMES) are exempt by name; every other place is listed in
 * src/rules/blocks/overrides-readers.json with a count and a reason (`checkOverridesReaders` in check.ts).
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

/** The raw store of the "one reader" scan: a character's (or build's) tweaks. */
export const OVERRIDES_READER_FIELDS = ['overrides'];
/** The files that may read `overrides` freely: the stored reader, the one reader, the content door, the write
 *  door, the save path, the migration (blocks/) and the held-feats helper (it hands `build.overrides` to
 *  `activeGivenFeats`). Plan B section 7.1. */
export const OVERRIDES_READERS_HOMES = [
  'src/rules/blocks/stored.ts',
  'src/rules/blocks/active.ts',
  'src/rules/blocks/content.ts',
  'src/rules/blocks/write.ts',
  'src/rules/blocks/save.ts',
  'src/rules/blocks/migrate.ts',
  'src/rules/heldFeats.ts',
];
/** The "one reader" allowlist, repo-relative. */
export const OVERRIDES_READERS_ALLOW = 'src/rules/blocks/overrides-readers.json';

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
 * `<path>#<chain>` and `lines` the source lines (for the message). The `homes` files are skipped.
 */
export function scanReaders(files, { fields, homes }) {
  const skip = new Set(homes);
  const groups = new Map();
  for (const f of files) {
    const path = f.path.replace(/\\/g, '/');
    if (skip.has(path)) continue;
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

/** The feat-store hits (`featPicks`, `addedFeats`); FEAT_READERS_HOME is skipped. */
export function scanFeatReaders(files, fields = FEAT_READER_FIELDS) {
  return scanReaders(files, { fields, homes: [FEAT_READERS_HOME] });
}

/** The `overrides` hits; the OVERRIDES_READERS_HOMES files are skipped. */
export function scanOverridesReaders(files) {
  return scanReaders(files, { fields: OVERRIDES_READER_FIELDS, homes: OVERRIDES_READERS_HOMES });
}

/*
 * THE SLOT-CATEGORY SCAN (Tweaks phase 2, WP7, C10). An extra feat place's pick lives under
 * `<level>:extra<category>:<n>`, so a slot key's second part is no longer always a book category: read raw,
 * `extraclass` refused every feat in `fitsSlot`, never counted for the dedication rule and survived an ancestry
 * change. Every reader of a key's category asks `slotCategoryOf` (src/rules/heldFeats.ts) or `slotRefOf`
 * (src/rules/featSlots.ts). This scan finds every OTHER read of a key's category text, so a new one cannot quietly
 * read `extraclass` again. A HIT is:
 *   - `x.split(':')[1]` (also `?.[1]` and `.at(1)`; the split may be `split(/:/)` too);
 *   - an array binding `const [a, b] = x.split(':')` that binds the second part (also through `c ? x.split(':') : …`);
 *   - `const parts = x.split(':')` and then `parts[1]` / `parts.at(1)` in the same block;
 *   - `SLOT_PREFIX.exec(x)` or `x.match(SLOT_PREFIX)` (or through a name bound to SLOT_PREFIX) read at index 2:
 *     `SLOT_PREFIX.exec(x)![2]` / `.at(2)`, `const [, l, cat] = SLOT_PREFIX.exec(x)!`, or
 *     `const m = SLOT_PREFIX.exec(x)` and then `m[2]` / `m?.[2]` / `m.at(2)` in the same block;
 *   - a regular-expression literal holding `:([a-z]+):` (a copy of SLOT_PREFIX's category capture).
 * A split that is not of a slot key is a hit too (the scan cannot tell): it is listed with that reason. Keys and the
 * allowlist file (src/rules/blocks/slot-category-readers.json) work as for the feat readers; `checkSlotCategoryReaders`
 * (src/rules/blocks/check.ts) compares them in scripts/blocks-check.mjs.
 */
export const SLOT_CATEGORY_ALLOW = 'src/rules/blocks/slot-category-readers.json';
const SLOT_CATEGORY_FIELD = 'slotCategory';

const unwrap = (n) => {
  let x = n;
  while (x && (ts.isNonNullExpression(x) || ts.isParenthesizedExpression(x))) x = x.expression;
  return x;
};
const isIndex = (n, i) => !!n && ts.isNumericLiteral(n) && n.text === String(i);
/** `x.split(':')` or `x.split(/:/)` */
const isColonSplit = (n) => {
  const c = unwrap(n);
  if (!c || !ts.isCallExpression(c) || !ts.isPropertyAccessExpression(c.expression) || c.expression.name.text !== 'split') return false;
  const arg = c.arguments[0];
  return literalText(arg) === ':' || (!!arg && arg.kind === ts.SyntaxKind.RegularExpressionLiteral && arg.text === '/:/');
};
const splitsIn = (n) => {
  const c = unwrap(n);
  if (!c) return false;
  if (ts.isConditionalExpression(c)) return splitsIn(c.whenTrue) || splitsIn(c.whenFalse);
  return isColonSplit(c);
};
/** `x[i]` / `x?.[i]` or `x.at(i)` / `x?.at(i)`: the read's target, else undefined. */
const indexedAt = (n, i) => {
  if (ts.isElementAccessExpression(n) && isIndex(n.argumentExpression, i)) return n.expression;
  if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'at' && n.arguments.length === 1 && isIndex(n.arguments[0], i)) return n.expression.expression;
  return undefined;
};
/** The names bound to SLOT_PREFIX in a file (`const RE = SLOT_PREFIX`, and names bound to those), SLOT_PREFIX itself
 *  included. */
const slotPrefixNames = (sf) => {
  const names = new Set(['SLOT_PREFIX']);
  for (let grew = true; grew; ) {
    grew = false;
    const visit = (n) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
        const init = unwrap(n.initializer);
        if (init && ts.isIdentifier(init) && names.has(init.text) && !names.has(n.name.text)) {
          names.add(n.name.text);
          grew = true;
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return names;
};
/** An array binding pattern that binds element `i` (not a hole). */
const bindsIndex = (pat, i) => ts.isArrayBindingPattern(pat) && pat.elements.length > i && !ts.isOmittedExpression(pat.elements[i]);
/** The block a declaration's name is visible in. */
const scopeOf = (n) => {
  for (let x = n.parent; x; x = x.parent) if (ts.isBlock(x) || ts.isSourceFile(x) || ts.isCaseClause(x) || ts.isDefaultClause(x) || ts.isModuleBlock(x)) return x;
  return n.getSourceFile();
};

/** One file's slot-category reads: `{ field: 'slotCategory', chain, line }[]`, in source order. */
export function scanSlotCategoryText(path, text) {
  if (!text.includes('split') && !text.includes('SLOT_PREFIX') && !text.includes('[a-z]+')) return [];
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const out = [];
  const hit = (node) => out.push({ field: SLOT_CATEGORY_FIELD, chain: symbolChain(node), line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
  const prefix = slotPrefixNames(sf);
  const isPrefix = (n) => {
    const c = unwrap(n);
    return !!c && ts.isIdentifier(c) && prefix.has(c.text);
  };
  /** `SLOT_PREFIX.exec(x)` or `x.match(SLOT_PREFIX)` (SLOT_PREFIX or a name bound to it) */
  const isSlotExec = (n) => {
    const c = unwrap(n);
    if (!c || !ts.isCallExpression(c) || !ts.isPropertyAccessExpression(c.expression)) return false;
    if (c.expression.name.text === 'exec') return isPrefix(c.expression.expression);
    return c.expression.name.text === 'match' && isPrefix(c.arguments[0]);
  };
  /** Every `name[i]` / `name.at(i)` in the block `decl`'s name lives in. */
  const readsOfName = (decl, i) => {
    const name = decl.name.text;
    const look = (x) => {
      const target = unwrap(indexedAt(x, i));
      if (target && ts.isIdentifier(target) && target.text === name) hit(x);
      ts.forEachChild(x, look);
    };
    look(scopeOf(decl));
  };
  const visit = (n) => {
    const at1 = indexedAt(n, 1);
    const at2 = indexedAt(n, 2);
    if (at1 && isColonSplit(at1)) hit(n);
    else if (at2 && isSlotExec(at2)) hit(n);
    else if (ts.isVariableDeclaration(n) && n.initializer) {
      if (bindsIndex(n.name, 1) && splitsIn(n.initializer)) hit(n);
      // `const parts = k.split(':')` → every `parts[1]` in the block the name lives in.
      else if (ts.isIdentifier(n.name) && splitsIn(n.initializer)) readsOfName(n, 1);
      else if (isSlotExec(n.initializer) && bindsIndex(n.name, 2)) hit(n);
      // `const m = SLOT_PREFIX.exec(k)` → every `m[2]` in the block the name lives in.
      else if (isSlotExec(n.initializer) && ts.isIdentifier(n.name)) readsOfName(n, 2);
    } else if (n.kind === ts.SyntaxKind.RegularExpressionLiteral && n.getText(sf).includes(':([a-z]+):')) hit(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The slot-category hits of a set of files, grouped as `scanReaders` groups (`{ field, key, count, lines }[]`). */
export function scanSlotCategoryReaders(files) {
  const groups = new Map();
  for (const f of files) {
    const path = f.path.replace(/\\/g, '/');
    for (const h of scanSlotCategoryText(path, f.text)) {
      const key = `${path}#${h.chain}`;
      const g = groups.get(key) ?? { field: h.field, key, count: 0, lines: [] };
      g.count++;
      g.lines.push(h.line);
      groups.set(key, g);
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

/** An allowlist of a tree (the feat one by default), parsed; null when the file is missing; throws on bad
 *  JSON. */
export function readAllow(root, file = FEAT_READERS_ALLOW) {
  const p = join(root, file);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}
