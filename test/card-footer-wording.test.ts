import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { SHARED_FEATURE_FOOTER } from '../src/rules/featureText';
import { printedInsideFooter, stringLaneFooter } from '../src/sheet/spellCard';
import type { AstNode } from '../src/sheet/astStore';

/**
 * The card's "ours" footers speak player words (docs/card-design.md section 13, 2026-10-08). The owner,
 * on a footer that said our text came from an import: "why is it talking about the import in the app?
 * the user doesn't need to see that." The MARKER stays (every piece of text that is not the Archives page
 * is visibly marked as ours); its WORDS never say "import", "older", "lane" or other developer talk.
 *
 * Two checks:
 *  - Every string the app can draw that speaks about provenance — a string literal, template literal or
 *    JSX text in src/sheet or src/rules that mentions "Archives" or "our text", or that sits inside a JSX
 *    element marked ours (data-ours / .sd-ours / .card-nopage) — is free of those words. Read with the
 *    TypeScript parser, so comments (which explain history and are never drawn) are not strings.
 *  - The decided lines (section 7) are the ones the app draws, word for word.
 *
 * The word "import" elsewhere in the app is not provenance talk and stays: the Homebrew page's Import
 * button imports a file the player chose, and the portrait slot imports an image.
 */

const FORBIDDEN = /\b(?:imports?|imported|importer|older|lane|regen|mirror|scraped?)\b/i;
const PROVENANCE = /Archives|our text/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** The text a string-ish node draws (a template literal's `${…}` holes kept as a marker). */
function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((s) => '${…}' + s.literal.text).join('');
  if (ts.isJsxText(node)) return node.text.replace(/\s+/g, ' ').trim() || null;
  return null;
}

/** Is `node` inside a JSX element that carries the ours marker (data-ours, or class sd-ours / card-nopage)? */
function insideOurs(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    const opening = ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null;
    if (!opening) continue;
    for (const attr of opening.attributes.properties) {
      if (!ts.isJsxAttribute(attr)) continue;
      const name = attr.name.getText();
      if (name === 'data-ours') return true;
      if (name === 'className' && attr.initializer && /\b(?:sd-ours|card-nopage)\b/.test(attr.initializer.getText())) return true;
    }
  }
  return false;
}

/** Every provenance string in one file: [line, text]. Import / export module paths are not drawn text. */
function provenanceStrings(file: string, text: string): Array<[number, string]> {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Array<[number, string]> = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    const s = literalText(node);
    if (s !== null && (PROVENANCE.test(s) || insideOurs(node))) out.push([sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, s]);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// These assertions test OUR OWN wording (the ours footers decided in section 7 / section 13), never print: no printed clause applies.
describe('the card footers speak player words, never developer words (section 13, 2026-10-08)', () => {
  const files = [...sourceFiles('src/sheet'), ...sourceFiles('src/rules')];
  const found = files.flatMap((f) => provenanceStrings(f, readFileSync(f, 'utf8')).map(([line, s]) => ({ at: `${f.replace(/\\/g, '/')}:${line}`, s })));

  // batch card: #card-NOT-VACUOUS — the case measures something
  it('the scan reads the footers it guards (an empty scan would pass on nothing)', () => {
    const texts = found.map((x) => x.s);
    for (const want of ['Not from the Archives — our text', 'The Archives page could not load on this device — our text']) {
      expect(texts.filter((s) => s === want).length, want).toBeGreaterThanOrEqual(1);
    }
    expect(found.some((x) => x.at.startsWith('src/sheet/RecordCard.tsx:')), 'RecordCard read').toBe(true);
    // batch card: #card-NOT-VACUOUS — the case measures something
    expect(found.some((x) => x.at.startsWith('src/sheet/SpellsTab.tsx:')), 'SpellsTab read').toBe(true);
    expect(found.some((x) => x.at.startsWith('src/sheet/spellCard.ts:')), 'spellCard read').toBe(true);
    expect(found.some((x) => x.at.startsWith('src/rules/featureText.ts:')), 'featureText read').toBe(true);
  });

  // batch card: #card-FOOTER-WORDS — footers speak player words
  it('no provenance string the app can draw says "import", "older", "lane" or other developer words', () => {
    expect(found.filter((x) => FORBIDDEN.test(x.s)).map((x) => `${x.at} ${x.s}`)).toEqual([]);
  });

  // batch card: #card-FOOTER-WORDS — footers speak player words
  it('the decided lines, word for word (section 7)', () => {
    expect(SHARED_FEATURE_FOOTER).toBe('Not from the Archives — our text for your class');
    expect(stringLaneFooter('rite-of-repatriation')).toBe('Not from the Archives — our text; the Archives page prints no Heightened line for (+1)');
    const synthPage: AstNode = { t: 'doc', c: [{ t: 'title', c: [{ t: 'p', c: [{ t: 'text', v: 'Synthetic Feat Page' }] }] }] };
    expect(printedInsideFooter({ id: 'synthetic-inside-spell' }, synthPage)).toBe('Printed inside Synthetic Feat Page — our text');
    const fns = [SHARED_FEATURE_FOOTER, stringLaneFooter('rite-of-repatriation')!, printedInsideFooter({ id: 'synthetic-inside-spell' }, synthPage)!];
    // batch card: #card-FOOTER-WORDS — footers speak player words
    for (const s of fns) expect(s, s).not.toMatch(FORBIDDEN);
  });
});
