import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { build, content } from './_content';
import { ownedFeatureIds } from '../src/rules/derive';
import { explainStat } from '../src/rules/explain';
import { classOwnFeatureId, pageClassName, sharedFeatureFallback } from '../src/rules/featureText';
import { textOf } from '../src/sheet/astVisibility';
import type { AstNode } from '../src/sheet/astStore';
import type { ContentDatabase } from '../src/rules/types';

/**
 * PACKAGE M, ROUND 3 (a), LANDED in package I (item I9): the Thaumaturge has its own Perception Expertise record.
 *
 * Twelve class tables list `classFeatures/perception-expertise` and every one gives expert, but the record sat on
 * class-feature-1183, the Thaumaturge's Dark Archives (Remastered) page: "Your proficiency rank for Perception
 * increases to master." Package M's round-3 lane wanted it on class-feature-1075, the Exemplar's War of Immortals
 * printing of the expert sentence, and the checker found what that broke: the THAUMATURGE's class page links its
 * level-9 "perception expertise" (class-feature-609 → 1183) to this record, and the Thaumaturge had no record of
 * its own on 1183 (its level-9 row was perception-mastery, the Commander's Battlecry! page, a level-13 feature), so
 * the link would have opened the Exemplar's page and a Thaumaturge would read "expert" where print gives master.
 *
 * Package I did what that note asked for: a Thaumaturge record on class-feature-1183 (the magus / necromancer /
 * runesmith already had perception-expertise-<class>), its row in the Thaumaturge's table, and then the move of the
 * shared record to class-feature-1075. This file pins the landed state in both directions: the shared record on the
 * Exemplar's page saying expert, the Thaumaturge's record on its own page saying master, the class popup's table and
 * section saying the same, and the breakdown label that reads "Perception expertise" for both.
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

describe('the Thaumaturge\'s own link reads its own page (master)', () => {
  // batch package-i premise: class-feature-1183 "Your proficiency rank for Perception increases to master."
  it('the "perception expertise" link on the Thaumaturge class page opens class-feature-1183, which says master', () => {
    expect(thaumaturgeReadsMaster(db, cfTrees)).toEqual([]);
    expect(thaumaturgeLinkTarget(db)).toBe('perception-expertise-thaumaturge');
  });

  it('…which is the rank a Thaumaturge 9 has, from the record the table lists', () => {
    const ch = build('thaumaturge', 9);
    expect(ch.proficiencies.perception).toBe('master');
    expect(ownedFeatureIds(ch, db).has('perception-expertise-thaumaturge')).toBe(true);
    // The Commander's Battlecry! page (level 13) is no longer a Thaumaturge feature at all.
    expect(ownedFeatureIds(ch, db).has('perception-mastery')).toBe(false);
    expect(build('thaumaturge', 8).proficiencies.perception).toBe('expert');
  });

  it('the Thaumaturge\'s record and table row are the landed state: its own page, its own row at 9', () => {
    // batch package-i premise: class-feature-1183 "Your proficiency rank for Perception increases to master."
    const own = db.classFeatures['perception-expertise-thaumaturge'];
    expect(own).toMatchObject({ name: 'Perception Expertise', level: 9, traits: ['thaumaturge'], aonId: 'class-feature-1183', edition: 'remaster', source: { book: 'Pathfinder Dark Archive (Remastered)', license: 'OGL' } });
    expect(perceptionRank(own.description)).toBe('master');
    expect(own.description).not.toMatch(/Barbarian|Commander|Exemplar/);
    expect(cfTrees['perception-expertise-thaumaturge']).toMatchObject({ aon: 'class-feature-1183', url: '/Classes.aspx?ID=69' });
    expect(db.classes.thaumaturge.features).toContainEqual({ level: 9, featureId: 'perception-expertise-thaumaturge' });
    expect(db.classes.thaumaturge.features.map((f) => f.featureId)).not.toContain('perception-mastery');
  });

  it('the shared record sits on the Exemplar\'s page (class-feature-1075), which says expert', () => {
    // batch package-i premise: class-feature-1075 "Your proficiency rank for Perception increases to expert."
    expect(db.classFeatures['perception-expertise']).toMatchObject({ aonId: 'class-feature-1075', source: { book: 'Pathfinder War of Immortals', license: 'ORC' }, edition: 'remaster-era' });
    expect(cfTrees['perception-expertise']).toMatchObject({ aon: 'class-feature-1075', url: '/Classes.aspx?ID=65' });
    expect(perceptionRank(textOf(cfTrees['perception-expertise']))).toBe('expert');
    expect(pageClassName(textOf(cfTrees['perception-expertise']), classNames)).toBe('Exemplar');
  });

  it('planted: the Thaumaturge\'s table back on perception-mastery is caught (its link would open the Exemplar\'s expert page)', () => {
    // batch package-i premise: class-feature-1075 "Your proficiency rank for Perception increases to expert." (Class Exemplar)
    // The old held state, rebuilt in memory: the class no longer lists its own record, so the link falls through to the
    // shared record, whose page is the Exemplar's.
    const back = {
      ...db,
      classes: {
        ...db.classes,
        thaumaturge: {
          ...db.classes.thaumaturge,
          features: db.classes.thaumaturge.features.map((f) => (f.featureId === 'perception-expertise-thaumaturge' ? { ...f, featureId: 'perception-mastery' } : f)),
        },
      },
    } as ContentDatabase;
    const problems = thaumaturgeReadsMaster(back, cfTrees).join('\n');
    expect(problems).toMatch(/page of Exemplar/);
    expect(problems).toMatch(/says expert/);
    expect(problems).toMatch(/copied from class-feature-1075/);
  });

  it('planted: the old shared page back under the record the link opens is caught too (master text on an expert record)', () => {
    // The Thaumaturge's page swapped for the Exemplar's: the problems list names the page, the rank and the source.
    const exemplarPage = JSON.parse(JSON.stringify(cfTrees['perception-expertise'])) as AstNode & { aon?: string };
    const problems = thaumaturgeReadsMaster(db, { ...cfTrees, 'perception-expertise-thaumaturge': exemplarPage }).join('\n');
    expect(problems).toMatch(/page of Exemplar/);
    expect(problems).toMatch(/says expert/);
    expect(problems).toMatch(/copied from class-feature-1075/);
  });
});

/** Every rule for the Thaumaturge class-details prose, as one verdict over a text — so a planted text can be fed through it. */
function thaumaturgePopupProblems(text: string): string[] {
  const problems: string[] = [];
  const row = text.split('\n').find((l) => l.startsWith('| 9 |')) ?? '';
  if (!/Perception Expertise/.test(row)) problems.push('the level-9 table row does not name Perception Expertise');
  if (/Perception Mastery/.test(text)) problems.push('the prose still names Perception Mastery');
  const at = text.indexOf('### Perception Expertise (Level 9)');
  if (at < 0) {
    problems.push('there is no "Perception Expertise (Level 9)" section');
  } else {
    const rest = text.slice(at);
    const end = rest.indexOf('\n### ', 5);
    const section = end > 0 ? rest.slice(0, end) : rest;
    if (!section.includes('Your proficiency rank for Perception increases to master.')) problems.push('the section lacks the class-feature-1183 sentence');
    for (const other of ['**Barbarian**', '**Exemplar**', '**Investigator, Swashbuckler, Thaumaturge**']) {
      if (section.includes(other)) problems.push(`the section still holds the composite paragraph ${other}`);
    }
  }
  return problems;
}

describe('the Thaumaturge class popup says Perception Expertise, with the Thaumaturge\'s own sentence', () => {
  const text = String(db.classes.thaumaturge.description ?? '');

  // batch package-i premise: class-69 "perception expertise, skill increase, thaumaturgic expertise"
  // batch package-i premise: class-feature-1183 "Your proficiency rank for Perception increases to master."
  it('the level-9 table row and section read Perception Expertise: the class-feature-1183 sentence alone, no six-class composite', () => {
    expect(thaumaturgePopupProblems(text)).toEqual([]);
  });

  it('planted: the old popup text (Perception Mastery row, heading and composite section) is caught', () => {
    const composite = '**Barbarian** Your instinct heightens each of your senses further. Your proficiency rank for Perception increases to master.\n\n**Exemplar** Through your adventures, you\'ve developed keen awareness. Your proficiency rank for Perception increases to master.\n\n**Investigator, Swashbuckler, Thaumaturge** Through your adventures, you\'ve developed keen awareness and attention to detail. Your proficiency rank for Perception increases to master.';
    const old = text
      .replace('Thaumaturgic Expertise, Perception Expertise,', 'Thaumaturgic Expertise, Perception Mastery,')
      .replace('### Perception Expertise (Level 9)', '### Perception Mastery (Level 9)')
      .replace("You've developed keen awareness and attention to detail. Your proficiency rank for Perception increases to master.", composite);
    expect(old).not.toBe(text);
    const problems = thaumaturgePopupProblems(old).join('\n');
    expect(problems).toMatch(/does not name Perception Expertise/);
    expect(problems).toMatch(/still names Perception Mastery/);
    expect(problems).toMatch(/no "Perception Expertise \(Level 9\)" section/);
  });

  it('planted: only the heading kept but the composite paragraphs left in is caught', () => {
    const composite = '**Barbarian** Your instinct heightens each of your senses further. Your proficiency rank for Perception increases to master.';
    const half = text.replace("You've developed keen awareness and attention to detail. Your proficiency rank for Perception increases to master.", composite);
    expect(half).not.toBe(text);
    expect(thaumaturgePopupProblems(half).join('\n')).toMatch(/composite paragraph \*\*Barbarian\*\*/);
  });
});

describe('the Perception breakdown reads the printed feature name', () => {
  // batch package-i premise: class-feature-1183 "Your proficiency rank for Perception increases to master."
  it('a Thaumaturge 9: "Raised to Master", from "Perception expertise" (not "Perception mastery", not "… thaumaturge")', () => {
    const tl = explainStat(build('thaumaturge', 9), db, { kind: 'perception' }).timeline;
    const step = tl.find((e) => e.level === 9);
    expect(step).toMatchObject({ text: 'Raised to Master', detail: 'Perception expertise', rank: 'master' });
  });

  it('only a class\'s own suffix is dropped: a source that does not end in the class id reads as typed', () => {
    // The magus's row is still the pre-remaster "alertness"; the strip must leave it alone.
    const step = explainStat(build('magus', 9), db, { kind: 'perception' }).timeline.find((e) => e.level === 9);
    expect(step).toMatchObject({ text: 'Raised to Expert', detail: 'Alertness' });
  });

  it('the same strip reads an inventor\'s armor step as "Medium armor expertise"', () => {
    const step = explainStat(build('inventor', 11), db, { kind: 'ac' }).timeline.find((e) => e.level === 11);
    expect(step?.detail).toBe('Medium armor expertise');
  });
});

describe('a cleric 9 reads expert (through the shared-feature text)', () => {
  const cleric9 = () => build('cleric', 9, { subclassId: 'cloistered-cleric', deityId: 'sarenrae' });

  // batch package-m premise: class-33 (Cleric, Player Core) "Perception Expertise … Your proficiency rank for Perception increases to expert"
  it('owns the feature and is expert in Perception', () => {
    const ch = cleric9();
    expect(ownedFeatureIds(ch, db).has('perception-expertise')).toBe(true);
    expect(ch.proficiencies.perception).toBe('expert');
  });

  it('the card text for the cleric says expert, from the record\'s own page', () => {
    const page = textOf(cfTrees['perception-expertise']);
    const card = sharedFeatureFallback('perception-expertise', 'cleric', page, db);
    // The page now names the Exemplar, not the Cleric, so the cleric still gets the shared-feature text.
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
