/*
 * THE VISIBLE-WORDS SCAN — Tweaks spec item 1 ("the player never sees the word override"), plan B
 * (work/tweaks-part-b-notes/plan.md) section 7.2, WP9b.
 *
 * The per-character "Overrides" card was renamed Tweaks. Its STORED names stay forever (`overrides`,
 * `overridesEnabled`, the `override:<id>` slot keys, `OursKind 'override'`, the `ovr-*` CSS classes), so a
 * plain text search for "override" finds hundreds of lines that are fine. This scan finds only the TEXT a
 * player could read: it walks every src/**\/*.ts(x) file with the TypeScript compiler API (never a regex: a
 * regex cannot tell a label from a key) and collects
 *   - string literals ('…', "…") and no-substitution templates (`…`),
 *   - the text chunks of a template (`Your override: ${x}` → "Your override: "),
 *   - JSX text (<p>Overrides</p>),
 * whose text matches /\boverrid\w*\/i AND reads as prose: it contains a space, or the matched word starts with a
 * capital "O". So these pass by construction: identifiers and property names (`overridesEnabled`,
 * `hitPoints.maxOverride` — not a word start), a lowercase one-word key or value ('override:' + id,
 * kind: 'override', 'overrides'), comments, and anything inside a type.
 * Text that is ALWAYS shown — JSX text, and the value of a title / aria-label / placeholder / alt attribute —
 * is a hit even as one lowercase word (<span>overridden</span>): the prose test is skipped for it.
 * Also never a hit: a JSX `className` / `class` value and the strings inside one (class names are never shown),
 * and an import / export module path. An object literal's key IS text (it can be rendered through Object.keys).
 *
 * Exemption, one literal at a time: the comment `// tweaks-ok: <reason>` (in JSX: `{/* tweaks-ok: <reason> *\/}`)
 * alone on the line ABOVE the line the text starts on. Used once, for "Moved from Overrides" (decision 19 names
 * the old card on purpose). Every marker found is reported too, so the check can fail a marker that exempts
 * nothing (stale) or gives no reason.
 *
 * The pure rule that judges the hits is `checkVisibleOverrideWords` in src/rules/blocks/check.ts (its skip list,
 * VISIBLE_WORDS_SKIP, names the files whose "override" is ANOTHER concept, each with a why);
 * scripts/blocks-check.mjs (npm run verify) runs both.
 */
import ts from 'typescript';

/** The words the scan looks for: "override", "overrides", "overridden", "Override(s)" … */
export const VISIBLE_WORD_RE = /\boverrid\w*/gi;
/** The inline exemption marker; the reason is everything after the colon. */
export const VISIBLE_WORDS_MARKER = 'tweaks-ok:';
/** A whole line that is the marker comment; group 1 = the reason. */
const MARKER_LINE = /^\s*(?:\/\/|\{?\/\*)\s*tweaks-ok:(.*?)(?:\*\/\}?)?\s*$/;

/** Does this text read as prose that names the word (a space anywhere, or a capital "O" word)? */
export function readsAsProse(text) {
  const words = [...text.matchAll(VISIBLE_WORD_RE)].map((m) => m[0]);
  if (!words.length) return false;
  return /\s/.test(text) || words.some((w) => w[0] === 'O');
}

/** Is this node inside a type (an interface, a type alias, any type annotation or type argument)? */
function inType(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isTypeNode(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) return true;
    if (ts.isBlock(n) || ts.isSourceFile(n)) return false;
  }
  return false;
}

/** Is this literal inside a JSX `className` / `class` attribute's value (a string, or any expression)? */
function inClassAttr(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isJsxAttribute(n)) {
      const name = n.name && ts.isIdentifier(n.name) ? n.name.text : n.name?.getText?.();
      return name === 'className' || name === 'class';
    }
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isSourceFile(n)) return false;
  }
  return false;
}

/**
 * A literal that is not text: an import / export path or a dynamic `import('…')`. An object literal's KEY is
 * text like any other (`{ 'Manual override': 1 }` can reach the screen through Object.keys(…).map(…)): a
 * lowercase one-word key passes readsAsProse, and a key inside a type passes inType.
 */
function notText(node) {
  const p = node.parent;
  if (!p) return false;
  if ((ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === node) return true;
  if (ts.isExternalModuleReference(p)) return true;
  if (ts.isCallExpression(p) && p.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  return false;
}

/** The JSX attributes whose value is always shown to the player (as a tooltip, a screen-reader label, …). */
const SHOWN_ATTRS = new Set(['title', 'aria-label', 'placeholder', 'alt']);
const HAS_WORD = /\boverrid\w*/i;

/**
 * Is this text always shown, so even a lowercase one-word "overridden" is read by the player? JSX text, or the
 * value of a title / aria-label / placeholder / alt attribute (`title="x"`, `title={'x'}`), also when it only
 * passes through brackets, a template, `a ? x : y`, `x || y` or `x ?? y` on its way there.
 */
function alwaysShown(node, k) {
  if (k === 'jsx') return true;
  let c = node;
  let p = node.parent;
  while (p && (ts.isParenthesizedExpression(p) || ts.isTemplateSpan(p) || ts.isTemplateExpression(p)
    || (ts.isConditionalExpression(p) && p.condition !== c)
    || (ts.isBinaryExpression(p) && (p.operatorToken.kind === ts.SyntaxKind.BarBarToken
      || p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)))) {
    c = p;
    p = p.parent;
  }
  if (p && ts.isJsxExpression(p) && p.expression === c) p = p.parent;
  if (!p || !ts.isJsxAttribute(p) || p.initializer === undefined) return false;
  const name = ts.isIdentifier(p.name) ? p.name.text : p.name.getText();
  return SHOWN_ATTRS.has(name);
}

/**
 * One file's scan: `{ hits, markers }`.
 *   hits:    `{ path, line, text, kind: 'string' | 'template' | 'jsx', marker?: string }[]` — `marker` is the
 *            reason of a `// tweaks-ok:` marker that covers the hit ('' when the marker gives none).
 *   markers: `{ path, line, reason, used }[]` — every marker in the file; `used` when it covers a hit.
 * `path` decides TSX parsing only.
 */
export function scanVisibleWords(path, text) {
  const markers = [];
  text.split('\n').forEach((l, i) => {
    // Only a line that IS the comment counts — `// tweaks-ok: …`, or `{/* tweaks-ok: … */}` above JSX text — so a
    // string that spells the marker (this file's constant, a guard message) is never one.
    const m = MARKER_LINE.exec(l);
    if (m) markers.push({ path, line: i + 1, reason: m[1].trim(), used: false });
  });
  VISIBLE_WORD_RE.lastIndex = 0;
  if (!/overrid/i.test(text)) return { hits: [], markers };
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const hits = [];
  const markerAt = new Map(markers.map((m) => [m.line, m]));
  const add = (node, raw, k) => {
    if (alwaysShown(node, k) ? !HAS_WORD.test(raw) : !readsAsProse(raw)) return;
    if (inType(node) || inClassAttr(node) || notText(node)) return;
    // JSX text carries its leading newlines and indent: its line is the line of its first word.
    const start = k === 'jsx' ? node.pos + (raw.length - raw.trimStart().length) : node.getStart(sf);
    const line = sf.getLineAndCharacterOfPosition(start).line + 1;
    const hit = { path, line, text: raw.replace(/\s+/g, ' ').trim().slice(0, 160), kind: k };
    const m = markerAt.get(line - 1);
    if (m) {
      m.used = true;
      hit.marker = m.reason;
    }
    hits.push(hit);
  };
  const visit = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) add(n, n.text, 'string');
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) add(n, n.text, 'template');
    else if (ts.isJsxText(n)) add(n, n.text, 'jsx');
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { hits, markers };
}

/** The scan of a set of files (`{ path, text }[]`, paths repo-relative): `{ hits, markers }`, in file order. */
export function scanVisibleWordFiles(files) {
  const hits = [];
  const markers = [];
  for (const f of files) {
    const r = scanVisibleWords(f.path.replace(/\\/g, '/'), f.text);
    hits.push(...r.hits);
    markers.push(...r.markers);
  }
  return { hits, markers };
}
