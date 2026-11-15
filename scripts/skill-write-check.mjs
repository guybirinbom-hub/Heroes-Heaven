/*
 * GUARD G2 (skill-rank order, plan work/skill-rank-level-by-level/plan.md, WP1): NO SKILL RANK IS WRITTEN IN
 * src/rules/build.ts OUTSIDE THE SKILL LEDGER.
 *
 * `buildCharacter` records every skill write and every skill judgement in one ledger (src/rules/skillPass.ts,
 * plan D1) so the ranks can be worked out level by level from it. A write that bypasses the ledger would
 * still change the sheet today and then silently differ between the live order and the print order — the
 * ledger replay test (test/skill-ledger.test.ts, G3) catches it only for the characters it builds; this scan
 * catches it in the source, for every path.
 *
 * Read with the TypeScript parser (no regex over code). A finding is:
 *   - an assignment (`=`, `??=`, `||=`, `&&=`), `delete`, `++` or `--` whose target is INSIDE a skills record —
 *     any member path with a segment named `skills` or `skills<Upper>…` (`skillsBeforeIncreases`) before its
 *     last one: `proficiencies.skills[k] = r`, `proficiencies.skills.stealth = 'expert'`, `skills[k] = r`;
 *   - a WHOLE skills record replaced on a proficiency block or as a bare variable: `proficiencies.skills = …`,
 *     `p.skills = …`, `skills = …` (a declaration is not an assignment; `cur.skills = …` on an item's bonus
 *     map is not a rank record and is not flagged);
 *   - `Object.assign(<a skills record>, …)`;
 *   - (WP6L) a DESTRUCTURING write whose targets include one of the above (`({ stealth: skills.stealth } = x)`,
 *     `[skills[k]] = [r]`, `({ skills } = x)`), and a `for (… of / in …)` loop whose loop variable is one;
 *   - (WP6L) a whole record replaced through its block: `proficiencies = { …, skills: x }`, and
 *     `Object.assign(<a proficiency block>, …)` with a `skills` key, a spread, or a source it cannot see into;
 *   - a call of `applySkillOp(…)` — the ledger's one mutation primitive — anywhere but inside the helpers.
 * Not seen (by design, a name-based scan): a write through a variable that ALIASES a skills record under another
 * name (`const into = proficiencies.skills; into[k] = r`). The ledger replay test (test/skill-ledger.test.ts, G3)
 * is the runtime guard for that class: every unrecorded write shows there as the character and the key.
 * Allowed only inside the symbols in ALLOWED (anchored by name, never by line): `skillWrite` (the ledger's
 * writer), `applyExactClamp` (the "exactly" clamp, which runs after the order) and `swapInPrintSkills` (the
 * print pass's resolve swap, plan WP3: the live ranks are replaced by the print ranks once, at the resolve point).
 *
 *   node scripts/skill-write-check.mjs              # src/rules/build.ts
 *   node scripts/skill-write-check.mjs --file <path> # a copy (planted proofs)
 * Exit 1 names each finding as path:line and the source line.
 */
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fileArg = process.argv.indexOf('--file');
const FILE = fileArg >= 0 && process.argv[fileArg + 1] ? resolve(process.argv[fileArg + 1]) : join(ROOT, 'src', 'rules', 'build.ts');

/** The only symbols a skill write may live in. */
export const ALLOWED = new Set(['skillWrite', 'applyExactClamp', 'swapInPrintSkills']);

const SKILLS_SEGMENT = /^skills(?:$|[A-Z])/;

/** The member path of an expression, root first: `proficiencies.skills[k]` → ['proficiencies', 'skills', '[]']. */
function pathOf(node) {
  const out = [];
  let n = node;
  for (;;) {
    if (ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n) || ts.isAsExpression(n) || ts.isTypeAssertionExpression?.(n) || ts.isSatisfiesExpression?.(n)) n = n.expression;
    else if (ts.isPropertyAccessExpression(n)) {
      out.unshift(n.name.text);
      n = n.expression;
    } else if (ts.isElementAccessExpression(n)) {
      out.unshift('[]');
      n = n.expression;
    } else if (ts.isIdentifier(n)) {
      out.unshift(n.text);
      return out;
    } else {
      out.unshift('?');
      return out;
    }
  }
}

/** Does writing to this target path change a skills rank record? */
function writesSkills(path) {
  // Into a record: a skills segment anywhere before the last segment.
  for (let i = 0; i < path.length - 1; i++) if (SKILLS_SEGMENT.test(path[i])) return true;
  // The whole record: a bare skills variable, or a proficiency block's `skills`.
  const last = path[path.length - 1];
  if (!SKILLS_SEGMENT.test(last)) return false;
  if (path.length === 1) return true;
  return path.includes('proficiencies') || path[0] === 'p';
}

/** The name of the function (declaration, or arrow/function expression bound to a variable) enclosing `node`. */
function enclosingNames(node) {
  const names = [];
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isFunctionDeclaration(n) && n.name) names.push(n.name.text);
    else if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.parent && ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)) names.push(n.parent.name.text);
  }
  return names;
}

const ASSIGN = new Set([ts.SyntaxKind.EqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken]);

const unwrap = (n) => {
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isTypeAssertionExpression?.(n) || ts.isSatisfiesExpression?.(n)) n = n.expression;
  return n;
};

/**
 * The targets a DESTRUCTURING assignment writes (skill order WP6L item 6): `({ stealth: skills.stealth } = x)`,
 * `[skills[k]] = [r]`, `({ skills } = x)` (the bare record), with defaults (`[skills[k] = 'trained'] = []`),
 * rests and nesting.
 */
function destructuredTargets(pattern) {
  const out = [];
  const element = (e) => {
    e = unwrap(e);
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken) return element(e.left);
    if (ts.isSpreadElement(e)) return element(e.expression);
    if (ts.isObjectLiteralExpression(e) || ts.isArrayLiteralExpression(e)) return void out.push(...destructuredTargets(e));
    if (!ts.isOmittedExpression(e)) out.push(e);
  };
  if (ts.isArrayLiteralExpression(pattern)) for (const e of pattern.elements) element(e);
  else
    for (const p of pattern.properties) {
      if (ts.isPropertyAssignment(p)) element(p.initializer);
      else if (ts.isShorthandPropertyAssignment(p)) out.push(p.name);
      else if (ts.isSpreadAssignment(p)) element(p.expression);
    }
  return out;
}

/** The names of an object literal's own keys that name a skills record (`{ skills: … }`, `{ skills }`). */
function skillsKeysOf(obj) {
  const out = [];
  for (const p of obj.properties) {
    const name = (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null;
    if (name && SKILLS_SEGMENT.test(name)) out.push(name);
  }
  return out;
}

/** Is `path` a proficiency block (`proficiencies`, `c.proficiencies`) — a record whose `skills` IS the rank record? */
const isProficiencyBlock = (path) => path[path.length - 1] === 'proficiencies';

export function scanSkillWrites(text, fileName = 'build.ts') {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const findings = [];
  const hit = (node, what) => {
    if (enclosingNames(node).some((n) => ALLOWED.has(n))) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    findings.push({ line: line + 1, what, source: text.split('\n')[line].trim() });
  };
  const visit = (node) => {
    const left = ts.isBinaryExpression(node) && ASSIGN.has(node.operatorToken.kind) ? unwrap(node.left) : null;
    if (left && (ts.isObjectLiteralExpression(left) || ts.isArrayLiteralExpression(left))) {
      if (destructuredTargets(left).some((t) => writesSkills(pathOf(t)))) hit(node, 'destructuring assignment');
      // One finding per pattern: a default inside it (`[skills[k] = 'trained'] = []`) is not a second write.
      return void visit(node.right);
    } else if (left && writesSkills(pathOf(left))) hit(node, 'assignment');
    // A whole record replaced through its block: `proficiencies = { ...p, skills: x }`, `c.proficiencies = { skills }`.
    else if (left && ts.isObjectLiteralExpression(unwrap(node.right)) && skillsKeysOf(unwrap(node.right)).some((k) => writesSkills([...pathOf(left), k])))
      hit(node, 'assignment (whole record)');
    else if ((ts.isForOfStatement(node) || ts.isForInStatement(node)) && !ts.isVariableDeclarationList(node.initializer)) {
      const init = unwrap(node.initializer);
      const targets = ts.isObjectLiteralExpression(init) || ts.isArrayLiteralExpression(init) ? destructuredTargets(init) : [init];
      if (targets.some((t) => writesSkills(pathOf(t)))) hit(node, 'loop assignment');
    } else if (ts.isDeleteExpression(node) && writesSkills(pathOf(node.expression))) hit(node, 'delete');
    else if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) && writesSkills(pathOf(node.operand))) hit(node, 'increment');
    else if (ts.isCallExpression(node)) {
      const callee = pathOf(node.expression).join('.');
      if (callee === 'applySkillOp') hit(node, 'applySkillOp call');
      else if (callee === 'Object.assign' && node.arguments[0]) {
        const p = pathOf(node.arguments[0]);
        if (writesSkills([...p, '[]'])) hit(node, 'Object.assign');
        // The whole record replaced (WP6L item 6): `Object.assign(proficiencies, { skills: x })`; onto a proficiency
        // block, also any source the scan cannot see into (`Object.assign(c.proficiencies, other)`, a spread).
        else if (
          node.arguments.slice(1).some((a) => {
            const src = unwrap(a);
            if (!ts.isObjectLiteralExpression(src)) return isProficiencyBlock(p);
            return skillsKeysOf(src).some((k) => writesSkills([...p, k])) || (isProficiencyBlock(p) && src.properties.some((q) => ts.isSpreadAssignment(q)));
          })
        )
          hit(node, 'Object.assign (whole record)');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const text = readFileSync(FILE, 'utf8');
  // The helpers must exist: a renamed `skillWrite` would make every write a finding — and an empty ALLOWED
  // match would make the check pass on a file that lost its ledger.
  const missing = [...ALLOWED].filter((n) => !new RegExp(`(?:function\\s+${n}\\s*\\(|const\\s+${n}\\s*=)`).test(text));
  const findings = scanSkillWrites(text, FILE);
  if (missing.length || findings.length) {
    for (const m of missing) console.error(`skill-write-check: ${FILE}: the allowed helper \`${m}\` is gone (rename it here too, or restore it)`);
    for (const f of findings) console.error(`skill-write-check: ${FILE}:${f.line}: ${f.what} on a skills record outside the skill ledger — ${f.source}`);
    console.error(`skill-write-check: route the write through buildCharacter's skillWrite (or a skillJudge effect); see src/rules/skillPass.ts.`);
    process.exit(1);
  }
  console.log(`skill-write-check: ok — every skill write in ${FILE.slice(ROOT.length + 1) || FILE} goes through ${[...ALLOWED].join(' / ')}`);
}
