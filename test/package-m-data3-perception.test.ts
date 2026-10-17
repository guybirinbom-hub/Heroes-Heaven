import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { build, content } from './_content';
import { ownedFeatureIds } from '../src/rules/derive';
import { classOwnFeatureId, pageClassName, sharedFeatureFallback } from '../src/rules/featureText';
import { textOf } from '../src/sheet/astVisibility';
import type { AstNode } from '../src/sheet/astStore';
import type { ContentDatabase } from '../src/rules/types';

/**
 * PACKAGE M, ROUND 3 (a) — HELD: the shared Perception Expertise record stays on the Thaumaturge's page.
 *
 * Twelve class tables list `classFeatures/perception-expertise` and every one gives expert, but the record sits
 * on class-feature-1183, the Thaumaturge's Dark Archives (Remastered) page: "Your proficiency rank for
 * Perception increases to master." The round-3 lane moved it to class-feature-1075, the Exemplar's War of
 * Immortals printing of the expert sentence. The checker found what that broke: the THAUMATURGE's class page
 * links its level-9 "perception expertise" (class-feature-609 → 1183) to this record, and the Thaumaturge has
 * no record of its own on 1183 (its level-9 row is perception-mastery, the Commander's Battlecry! page), so the
 * link would open the Exemplar's page and a Thaumaturge would read "expert" where print gives master
 * (test/feature-text.test.ts "no class page link opens another class's page" went red).
 *
 * So the move waits for the orchestrator: a create row for a Thaumaturge record on class-feature-1183 (the
 * magus / necromancer / runesmith already have perception-expertise-<class>) and its row in the Thaumaturge's
 * table. This file pins the held state so the move cannot land alone again, and keeps the two things that are
 * right today: a cleric's card says expert, the Thaumaturge's link says master.
 */
const db = content();
const cfTrees = JSON.parse(gunzipSync(readFileSync('public/ast/classFeatures.json.gz')).toString('utf8')) as Record<string, AstNode & { aon?: string; url?: string }>;
const classTrees = JSON.parse(gunzipSync(readFileSync('public/ast/classes.json.gz')).toString('utf8')) as Record<string, AstNode>;
const classNames = Object.values(db.classes).map((c) => c.name);
/** The rank a "Your proficiency rank for Perception increases to <rank>" page or text gives. */
const perceptionRank = (text: string | null | undefined) => /Perception increases to (\w+)/.exec(String(text ?? '').replace(/\s+/g, ' '))?.[1];

/** The record the Thaumaturge class page's "perception expertise" link opens, the way the card opens it. */
function thaumaturgeLinkTarget(d: ContentDatabase): string {
  const refs: string[] = [];
  const walk = (n: AstNode) => {
    const ref = (n as { ref?: string }).ref;
    if (n.t === 'link' && typeof ref === 'string' && ref.startsWith('classFeatures:perception-expertise')) refs.push(ref.slice('classFeatures:'.length));
    for (const k of n.c ?? []) walk(k);
  };
  walk(classTrees.thaumaturge);
  expect(refs, 'the Thaumaturge class page links its Perception Expertise once').toHaveLength(1);
  return classOwnFeatureId(refs[0], 'thaumaturge', d);
}

/** Every rule below, as one verdict over a set of pages — so a planted page can be fed through it. */
function thaumaturgeReadsMaster(d: ContentDatabase, trees: Record<string, AstNode & { aon?: string }>): string[] {
  const problems: string[] = [];
  const id = thaumaturgeLinkTarget(d);
  const page = trees[id];
  if (!page) return [`the link opens ${id}, which has no page`];
  const text = textOf(page);
  if (pageClassName(text, classNames) !== 'Thaumaturge') problems.push(`the link opens ${id}, the page of ${pageClassName(text, classNames)}`);
  if (perceptionRank(text) !== 'master') problems.push(`the link opens ${id}, which says ${perceptionRank(text)}`);
  if (page.aon !== 'class-feature-1183') problems.push(`the link opens ${id}, copied from ${page.aon}`);
  return problems;
}

describe('held: the Thaumaturge\'s own link reads its own page (master)', () => {
  // batch package-m premise: class-feature-1183 "Your proficiency rank for Perception increases to master."
  it('the "perception expertise" link on the Thaumaturge class page opens class-feature-1183, which says master', () => {
    expect(thaumaturgeReadsMaster(db, cfTrees)).toEqual([]);
  });

  it('…which is the rank a Thaumaturge 9 has', () => {
    expect(build('thaumaturge', 9).proficiencies.perception).toBe('master');
  });

  it('the shared record may leave class-feature-1183 only once a record of the Thaumaturge\'s own carries it', () => {
    const rec = db.classFeatures['perception-expertise'];
    if (rec.aonId !== 'class-feature-1183') {
      const own = Object.entries(db.classFeatures).filter(([, r]) => r.aonId === 'class-feature-1183').map(([k]) => k);
      expect(own, 'a Thaumaturge record on class-feature-1183').not.toEqual([]);
      expect(db.classes.thaumaturge.features.some((f) => own.includes(f.featureId)), 'in the Thaumaturge\'s table').toBe(true);
    } else {
      expect(rec).toMatchObject({ source: { book: 'Pathfinder Dark Archive (Remastered)', license: 'OGL' }, edition: 'remaster' });
      expect(cfTrees['perception-expertise'].aon).toBe('class-feature-1183');
      expect(cfTrees['perception-expertise'].url).toBe('/Classes.aspx?ID=69');
    }
  });

  it('planted: the round-3 move alone (the Exemplar\'s expert page under the record) is caught', () => {
    // batch package-m premise: class-feature-1075 "Your proficiency rank for Perception increases to expert." (Class Exemplar)
    const moved = JSON.parse(JSON.stringify(cfTrees['perception-expertise'])
      .replace('increases to master.', 'increases to expert.')
      .replace(/Thaumaturge/g, 'Exemplar')) as AstNode & { aon?: string };
    moved.aon = 'class-feature-1075';
    const problems = thaumaturgeReadsMaster(db, { ...cfTrees, 'perception-expertise': moved });
    expect(problems.join('\n')).toMatch(/page of Exemplar/);
    expect(problems.join('\n')).toMatch(/says expert/);
    expect(problems.join('\n')).toMatch(/copied from class-feature-1075/);
  });
});

describe('a cleric 9 reads expert (today, through the shared-feature text)', () => {
  const cleric9 = () => build('cleric', 9, { subclassId: 'cloistered-cleric', deityId: 'sarenrae' });

  // batch package-m premise: class-33 (Cleric, Player Core) "Perception Expertise … Your proficiency rank for Perception increases to expert"
  it('owns the feature and is expert in Perception', () => {
    const ch = cleric9();
    expect(ownedFeatureIds(ch, db).has('perception-expertise')).toBe(true);
    expect(ch.proficiencies.perception).toBe('expert');
  });

  it('the card text for the cleric says expert: the page names another class, so the cleric reads the record\'s own text', () => {
    const page = textOf(cfTrees['perception-expertise']);
    const card = sharedFeatureFallback('perception-expertise', 'cleric', page, db);
    expect(card, 'the page names another class: the cleric gets the shared-feature text').not.toBeNull();
    expect(perceptionRank(card)).toBe('expert');
    expect(card).not.toMatch(/master/);
  });

  it('planted: with the record\'s text gone the cleric card has nothing — it never falls back to the master page', () => {
    const page = textOf(cfTrees['perception-expertise']);
    const bare = { ...db, classFeatures: { ...db.classFeatures, 'perception-expertise': { ...db.classFeatures['perception-expertise'], description: undefined } } } as ContentDatabase;
    expect(sharedFeatureFallback('perception-expertise', 'cleric', page, bare)).toBe('');
  });
});
