import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { classFeatureDescription, classOwnFeatureId, featureBaseName, pageClassName, sharedFeatureBook, sharedFeatureFallback } from '../src/rules/featureText';
import { textOf } from '../src/sheet/astVisibility';
import type { AstNode } from '../src/sheet/astStore';
import type { ContentDatabase } from '../src/rules/types';

const c = content();

describe('classFeatureDescription — shared-feature contamination guard', () => {
  it('strips another class’s addendum (bard Reflex Expertise drops the Guardian note)', () => {
    const raw = c.classFeatures['reflex-expertise'].description;
    expect(raw).toContain('Guardian'); // the shared source DOES carry the Guardian addendum
    const bard = classFeatureDescription(raw, 'bard', c);
    expect(bard).not.toContain('Guardian'); // …but a bard must not see it
    expect(bard).toContain('dodging danger'); // the generic paragraph stays
  });

  it('keeps the owning class’s own addendum (guardian Reflex Expertise keeps the Guardian note)', () => {
    const guardian = classFeatureDescription(c.classFeatures['reflex-expertise'].description, 'guardian', c);
    expect(guardian).toContain('Guardian');
  });

  it('strips an addendum that has LEADING WHITESPACE before the bold class name', () => {
    // A paragraph led by " **Guardian**" (leading space) or "\n**Guardian**" must still be
    // recognized as the Guardian addendum: stripped for a bard, kept for a guardian.
    const desc = 'Base text.\n\n  **Guardian** Even in the heaviest of armors you keep your footing.';
    const bard = classFeatureDescription(desc, 'bard', c);
    expect(bard).not.toContain('Guardian'); // leading whitespace no longer hides the addendum
    expect(bard).toContain('Base text.'); // generic paragraph stays
    const guardian = classFeatureDescription(desc, 'guardian', c);
    expect(guardian).toContain('Guardian'); // the owning class keeps its own note
  });

  it('never strips a non-class bold lead (e.g. a degree-of-success row)', () => {
    const desc = 'Base text.\n\n**Critical Success** You do the thing.\n\n**Failure** You do not.';
    expect(classFeatureDescription(desc, 'bard', c)).toBe(desc);
  });

  // The systematic guard: for EVERY class, none of its displayed feature descriptions may contain a
  // DIFFERENT class's name as a bold-led addendum paragraph. This catches any future shared feature
  // that ships a class-specific note, the same way Reflex/Weapon Expertise etc. do today.
  it('no class sees another class’s bold-led addendum in any of its features', () => {
    const classNames = Object.values(c.classes).map((cl) => cl.name.toLowerCase());
    const offenders: string[] = [];
    for (const cls of Object.values(c.classes)) {
      const others = new Set(classNames.filter((n) => n !== cls.name.toLowerCase()));
      for (const f of cls.features) {
        const feat = c.classFeatures[f.featureId];
        if (!feat) continue;
        const shown = classFeatureDescription(feat.description, cls.id, c);
        for (const para of shown.split(/\n{2,}/)) {
          const lead = para.match(/^\*\*([^*]+)\*\*/);
          if (lead && others.has(lead[1].trim().toLowerCase())) offenders.push(`${cls.id}/${f.featureId} → ${lead[1].trim()}`);
        }
      }
    }
    expect(offenders, offenders.join('; ')).toEqual([]);
  });
});

/**
 * Card step 12 (docs/card-design.md section 5, the classFeatureDescription row): a lead may name several
 * classes — "**Witch, Wizard**", "**Champion, Exemplar, Investigator, Magus**". The single-name rule kept
 * such a paragraph for EVERY class (a wizard 11 read the champion's "martial weapons"), and the guard above
 * compares whole leads, so it never saw one. Mutation (measured red 2026-10-06, restored byte-exact):
 * featureText.ts leadClasses back to one name per lead → every case below red but the cleric one.
 */
describe('classFeatureDescription — a lead that names several classes', () => {
  const we = c.classFeatures['weapon-expertise'].description;
  const pm = c.classFeatures['perception-mastery'].description;
  const rx = c.classFeatures['reflex-expertise'].description;
  const paragraphs = (s: string) => s.split(/\n{2,}/).map((p) => (p.match(/^\s*\*\*([^*]+)\*\*/) ?? [])[1] ?? '(generic)');

  // batch card: #card-OWN-SECTION — the record's own section, slice or class text
  it('Weapon Expertise: one paragraph per class, its own', () => {
    expect(we).toMatch(/\*\*Witch, Wizard\*\*/);
    const want: Record<string, string> = {
      wizard: 'Witch, Wizard', witch: 'Witch, Wizard', druid: 'Druid, Kineticist', kineticist: 'Druid, Kineticist',
      champion: 'Champion, Exemplar, Investigator, Magus', magus: 'Champion, Exemplar, Investigator, Magus',
      guardian: 'Guardian', oracle: 'Oracle', psychic: 'Psychic', sorcerer: 'Sorcerer', swashbuckler: 'Swashbuckler', thaumaturge: 'Thaumaturge',
    };
    // batch card: #card-OWN-SECTION — the record's own section, slice or class text
    for (const [cls, lead] of Object.entries(want)) expect(paragraphs(classFeatureDescription(we, cls, c)), cls).toEqual([lead]);
    expect(classFeatureDescription(we, 'wizard', c)).not.toMatch(/martial/);
    expect(classFeatureDescription(we, 'druid', c)).not.toMatch(/martial/);
    expect(classFeatureDescription(we, 'champion', c)).toMatch(/martial weapons/);
  });

  // batch card: #card-OWN-SECTION — the record's own section, slice or class text
  it('Perception Mastery: one paragraph per class, its own', () => {
    const want: Record<string, string> = {
      barbarian: 'Barbarian', bard: 'Bard, Gunslinger, Rogue', gunslinger: 'Bard, Gunslinger, Rogue', rogue: 'Bard, Gunslinger, Rogue',
      commander: 'Commander', exemplar: 'Exemplar', investigator: 'Investigator, Swashbuckler, Thaumaturge',
      swashbuckler: 'Investigator, Swashbuckler, Thaumaturge', thaumaturge: 'Investigator, Swashbuckler, Thaumaturge', ranger: 'Ranger',
    };
    // batch card: #card-OWN-SECTION — the record's own section, slice or class text
    for (const [cls, lead] of Object.entries(want)) expect(paragraphs(classFeatureDescription(pm, cls, c)), cls).toEqual([lead]);
  });

  // batch card: #card-OWN-SECTION — the record's own section, slice or class text
  it('Reflex Expertise: the generic paragraph for every class, the Guardian note for the guardian only', () => {
    for (const cls of ['bard', 'wizard', 'rogue', 'monk']) expect(paragraphs(classFeatureDescription(rx, cls, c)), cls).toEqual(['(generic)']);
    expect(paragraphs(classFeatureDescription(rx, 'guardian', c))).toEqual(['(generic)', 'Guardian']);
  });

  // batch card: #card-OWN-SECTION — the record's own section, slice or class text
  it('a cleric\'s Perception Expertise says expert (no class addenda: the text is whole)', () => {
    const pe = c.classFeatures['perception-expertise'].description;
    expect(classFeatureDescription(pe, 'cleric', c)).toBe(pe);
    // batch card premise: class-33 "Perception increases to expert"
    expect(pe).toMatch(/Perception increases to expert/);
  });

  // batch card: #card-OWN-SECTION — the record's own section, slice or class text
  it('no class sees a paragraph led by OTHER classes only, comma lists included', () => {
    const classNames = new Set(Object.values(c.classes).map((cl) => cl.name.toLowerCase()));
    const offenders: string[] = [];
    for (const cls of Object.values(c.classes)) {
      const me = cls.name.toLowerCase();
      for (const f of cls.features) {
        const feat = c.classFeatures[f.featureId];
        if (!feat) continue;
        for (const para of classFeatureDescription(feat.description, cls.id, c).split(/\n{2,}/)) {
          const lead = para.match(/^\s*\*\*([^*]+)\*\*/);
          const names = lead ? lead[1].split(/\s*,\s*|\s+and\s+/i).map((n) => n.trim().toLowerCase()) : [];
          if (names.length && names.every((n) => classNames.has(n)) && !names.includes(me)) offenders.push(`${cls.id}/${f.featureId} → ${lead![1].trim()}`);
        }
      }
    }
    // batch card: #card-OWN-SECTION — the record's own section, slice or class text
    expect(offenders, offenders.join('; ')).toEqual([]);
  });
});

/**
 * Package M (2026-10-16), found from the owner's swashbuckler "Weapon Expertise" screenshot. The
 * featureText.ts halves of the card fixes; the rendered halves are test/package-m-card-shared.test.tsx.
 *
 * MUTATION LINES (each measured red on 2026-10-16 under the heavy-job lock, then the file restored
 * byte-exact from its original bytes, sha1 checked; scratch pm-mutate.mjs runs C and E):
 *  - featureText.ts classFeatureDescription: `withoutStrayDividers(…)` taken off the cut → the Armor Mastery
 *    fighter / barbarian / champion case, the synthetic kept-divider case and the every-class sweep red.
 *  - featureText.ts sharedFeatureFallback: `raw === undefined ? ''` back to null when the text is absent →
 *    the wizard Weapon Expertise and cleric Perception Expertise text-absent cases red.
 *  - featureText.ts classOwnFeatureId: always the linked id → the magus and the planted swashbuckler cases red.
 *  - featureText.ts sharedFeatureBook: the class's book ignored (undefined) → the book case red.
 */
const isDivider = (p: string) => /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(p);
const paras = (s: string) => s.split(/\n{2,}/);
/** Where a text's dividers sit wrongly: first, last, or beside another divider. */
function strayDividers(s: string): string[] {
  const ps = paras(s);
  const out: string[] = [];
  ps.forEach((p, i) => {
    if (!isDivider(p)) return;
    if (i === 0) out.push('first');
    if (i === ps.length - 1) out.push('last');
    if (i > 0 && isDivider(ps[i - 1])) out.push(`doubled@${i}`);
  });
  return out;
}

describe('package M: Armor Mastery\'s dividers survive the per-class cut only where they divide', () => {
  const am = c.classFeatures['armor-mastery'].description;

  it('the shared text separates its class paragraphs with "---" (the premise)', () => {
    // batch M premise: class-feature-1109 "Your skill with armor improves, helping you avoid more blows"
    expect(paras(am).filter(isDivider).length).toBeGreaterThanOrEqual(2);
  });

  it('the fighter\'s text starts with its own paragraph, the barbarian\'s ends with it, the champion\'s has none', () => {
    const fighter = classFeatureDescription(am, 'fighter', c);
    expect(paras(fighter)[0]).toMatch(/^\*\*Fighter\*\*/);
    expect(strayDividers(fighter)).toEqual([]);
    const barbarian = classFeatureDescription(am, 'barbarian', c);
    expect(paras(barbarian)).toHaveLength(1);
    expect(barbarian).toMatch(/^\*\*Barbarian\*\*/);
    const champion = classFeatureDescription(am, 'champion', c);
    expect(paras(champion)).toEqual([expect.stringMatching(/^\*\*Champion, Commander\*\*/)]);
  });

  it('a divider between two kept paragraphs stays (a text the cut leaves whole is returned as it is)', () => {
    const desc = 'Generic text.\n\n---\n\n**Fighter** Fighter text.\n\n---\n\n**Wizard** Wizard text.\n\n---';
    expect(classFeatureDescription(desc, 'fighter', c)).toBe('Generic text.\n\n---\n\n**Fighter** Fighter text.');
    const own = c.classFeatures['weapon-expertise-swashbuckler']?.description;
    // batch M premise: class-feature-1019 "You gain access to the critical specialization effects of all weapons for which you have expert proficiency"
    if (own && paras(own).some(isDivider)) expect(classFeatureDescription(own, 'swashbuckler', c)).toBe(own);
  });

  it('no class sees a leading, trailing or doubled divider in any feature it lists', () => {
    const offenders: string[] = [];
    for (const cls of Object.values(c.classes)) {
      for (const f of cls.features ?? []) {
        const rec = c.classFeatures[f.featureId];
        if (!rec?.description) continue;
        const bad = strayDividers(classFeatureDescription(rec.description, cls.id, c));
        if (bad.length) offenders.push(`${cls.id}/${f.featureId}: ${bad.join(',')}`);
      }
    }
    expect(offenders, offenders.join('; ')).toEqual([]);
  });
});

describe('package M: a shared feature is decided from its page header and the class list, not its text', () => {
  const trees = JSON.parse(gunzipSync(readFileSync('public/ast/classFeatures.json.gz')).toString('utf8')) as Record<string, AstNode>;
  /** The content with one class feature's text not loaded yet (descriptions ship in a second file). */
  const withoutText = (id: string): ContentDatabase => {
    const { description: _d, ...rest } = c.classFeatures[id];
    void _d;
    return { ...c, classFeatures: { ...c.classFeatures, [id]: rest as typeof c.classFeatures[string] } };
  };

  it('a wizard 11\'s Weapon Expertise, its text not loaded: "" (the no-page lane, waiting) — never null (the Thaumaturge page)', () => {
    const page = textOf(trees['weapon-expertise']);
    // batch M premise: class-feature-1178 "You've learned the secret ways your weapons work most effectively"
    expect(page).toMatch(/Class Thaumaturge/);
    expect(sharedFeatureFallback('weapon-expertise', 'wizard', page, withoutText('weapon-expertise'))).toBe('');
    // …and with the text: the wizard's paragraph, as before.
    expect(sharedFeatureFallback('weapon-expertise', 'wizard', page, c)).toMatch(/Through sheer experience/);
  });

  it('the page\'s own class still draws its page with the text absent (null), and so does a class that does not list it', () => {
    const page = textOf(trees['weapon-expertise']);
    expect(sharedFeatureFallback('weapon-expertise', 'thaumaturge', page, withoutText('weapon-expertise'))).toBeNull();
    expect(sharedFeatureFallback('weapon-expertise', 'fighter', page, withoutText('weapon-expertise'))).toBeNull();
  });

  it('a cleric\'s Perception Expertise, text absent: "" — the page is another class\'s whatever its words', () => {
    const tree = trees['perception-expertise'];
    expect(tree, 'perception-expertise has a page').toBeTruthy();
    const page = textOf(tree);
    // The premise, asserted rather than assumed: the page is some other class's (the Thaumaturge's today,
    // the Exemplar's if the data lane re-points it), never the cleric's.
    const owner = pageClassName(page, Object.values(c.classes).map((x) => x.name));
    expect(owner, 'the page names its class').toBeTruthy();
    expect(owner).not.toBe('Cleric');
    expect(sharedFeatureFallback('perception-expertise', 'cleric', page, withoutText('perception-expertise'))).toBe('');
  });
});

describe('package M: a class\'s link opens the record that class lists under the same name', () => {
  it('base names: the "(Class)" qualifier and case drop', () => {
    expect(featureBaseName('Weapon Expertise (Swashbuckler)')).toBe('weapon expertise');
    expect(featureBaseName('Weapon Expertise')).toBe('weapon expertise');
    expect(featureBaseName(undefined)).toBe('');
  });

  it('the magus page\'s "weapon expertise" opens weapon-expertise-magus; a class that lists the shared record keeps it; no class keeps it', () => {
    // batch M premise: class-feature-1269 "learning the intricacies of your weapons"
    expect(c.classes.magus.features.some((f) => f.featureId === 'weapon-expertise-magus')).toBe(true);
    expect(classOwnFeatureId('weapon-expertise', 'magus', c)).toBe('weapon-expertise-magus');
    expect(classOwnFeatureId('weapon-expertise', 'wizard', c)).toBe('weapon-expertise');
    expect(classOwnFeatureId('weapon-expertise', undefined, c)).toBe('weapon-expertise');
    expect(classOwnFeatureId('weapon-expertise', 'no-such-class', c)).toBe('weapon-expertise');
  });

  it('the swashbuckler: its own record when its list names it, the shared one while its list names that', () => {
    const swash = c.classes.swashbuckler;
    const own = { ...c, classes: { ...c.classes, swashbuckler: { ...swash, features: swash.features.map((f) => (f.featureId === 'weapon-expertise' ? { ...f, featureId: 'weapon-expertise-swashbuckler' } : f)) } } };
    const shared = { ...c, classes: { ...c.classes, swashbuckler: { ...swash, features: swash.features.map((f) => (f.featureId === 'weapon-expertise-swashbuckler' ? { ...f, featureId: 'weapon-expertise' } : f)) } } };
    // batch M premise: class-feature-1019 "You gain access to the critical specialization effects of all weapons for which you have expert proficiency"
    expect(classOwnFeatureId('weapon-expertise', 'swashbuckler', own as ContentDatabase)).toBe('weapon-expertise-swashbuckler');
    expect(classOwnFeatureId('weapon-expertise', 'swashbuckler', shared as ContentDatabase)).toBe('weapon-expertise');
  });

  it('two same-named records on one class list: ambiguous, the linked record', () => {
    const wiz = c.classes.wizard;
    const two = { ...c, classes: { ...c.classes, wizard: { ...wiz, features: [...wiz.features.filter((f) => f.featureId !== 'weapon-expertise'), { level: 5, featureId: 'weapon-expertise-magus' }, { level: 5, featureId: 'weapon-expertise-swashbuckler' }] } } };
    expect(classOwnFeatureId('weapon-expertise', 'wizard', two as ContentDatabase)).toBe('weapon-expertise');
  });
});

/**
 * Package M, checker round 1 (2026-10-16): a class's advancement table names the plain feature ("weapon
 * mastery") where the class lists a class-qualified record ("Martial Weapon Mastery"), and its headings link
 * the plain words inside the qualified name ("Armor Expertise" inside "Light Armor Expertise"). The exact-name
 * pass found none of these, so the swashbuckler's own 13th-level row opened the Thaumaturge's page. Pass 2:
 * the listed record whose base name ENDS with the linked one, a later step ("Greater …") left out, the class's
 * first of several.
 * MUTATION LINES (measured red 2026-10-16 on scratch copies of featureText.ts swapped in by vi.mock from a
 * temporary test file that imported this one; the repo file was never changed, sha1 checked):
 *  - classOwnFeatureId's tail pass removed (`tail` = []) → every case in this block red (the keep-the-link
 *    case through its level-order line), and the class-page sweep red.
 *  - the STEP_PREFIX filter removed → the later-step-alone line red (the oracle's Resolve stays right
 *    through the first-by-level choice: Mysterious Resolve is 7th, Greater 17th).
 *  - the first-by-level choice removed (several → the linked record) → the swashbuckler Evasion case, the
 *    level-order line and the sweep (the swashbuckler's "Evasion" → the Alchemist's page) red.
 */
describe('package M: a class\'s table and headings open its class-qualified record', () => {
  it('"weapon mastery" on the swashbuckler, champion, investigator and ranger tables opens Martial Weapon Mastery; the fighter\'s its Fighter Weapon Mastery', () => {
    // batch M premise: class-63 (Swashbuckler, Player Core 2) "assured evasion, light armor expertise, precise strike 5 (5d6), skill increase, weapon mastery"
    // batch M premise: class-feature-732 "You fully understand the intricacies of weapons."
    for (const cls of ['swashbuckler', 'champion', 'investigator', 'ranger']) {
      expect(c.classes[cls].features.some((f) => f.featureId === 'weapon-mastery'), `${cls} does not list the shared record`).toBe(false);
      expect(classOwnFeatureId('weapon-mastery', cls, c), cls).toBe('martial-weapon-mastery');
    }
    expect(classOwnFeatureId('weapon-mastery', 'fighter', c)).toBe('fighter-weapon-mastery');
  });

  it('the psychic table\'s "weapon specialization" opens Psychic Weapon Specialization', () => {
    // batch M premise: class-68 (Psychic) "7th-rank spells, ancestry feat, personal barrier, skill increase, weapon specialization"
    expect(classOwnFeatureId('weapon-specialization', 'psychic', c)).toBe('psychic-weapon-specialization');
    // batch M premise: class-68 "As you touch a weapon, you glimpse the hands that made and wielded it"
    expect(c.classFeatures['psychic-weapon-specialization'].description).toMatch(/glimpse the hands/);
  });

  it('a heading\'s plain words open the heading\'s record: "Armor Expertise" in Light / Medium / Burnished Armor Expertise, "Weapon Expertise" in Bard / Simple Weapon Expertise', () => {
    expect(classOwnFeatureId('armor-expertise', 'swashbuckler', c)).toBe('light-armor-expertise');
    expect(classOwnFeatureId('armor-mastery', 'swashbuckler', c)).toBe('light-armor-mastery');
    expect(classOwnFeatureId('armor-expertise', 'alchemist', c)).toBe('medium-armor-expertise');
    expect(classOwnFeatureId('armor-expertise', 'exemplar', c)).toBe('burnished-armor-expertise');
    expect(classOwnFeatureId('weapon-expertise', 'bard', c)).toBe('bard-weapon-expertise');
    expect(classOwnFeatureId('weapon-expertise', 'animist', c)).toBe('simple-weapon-expertise');
    expect(classOwnFeatureId('resolve', 'guardian', c)).toBe('unyielding-resolve');
  });

  it('the oracle\'s "Resolve" opens Mysterious Resolve — a later step (Greater Mysterious Resolve) is never the class\'s own', () => {
    // batch M premise: class-feature-965 "The power of your mystery blazing in your soul makes it harder for other powers to grip your mind."
    expect(c.classes.oracle.features.some((f) => f.featureId === 'greater-mysterious-resolve')).toBe(true);
    expect(classOwnFeatureId('resolve', 'oracle', c)).toBe('mysterious-resolve');
  });

  it('the swashbuckler\'s "Evasion" (the "Confident Evasion" heading) opens Confident Evasion, the first of its line, not Assured Evasion', () => {
    // batch M premise: class-feature-1020 "You’ve learned to move quickly to avoid explosions, a dragon’s breath, and worse."
    expect(classOwnFeatureId('evasion', 'swashbuckler', c)).toBe('confident-evasion');
  });

  it('keeps the linked record: a class that lists it, a later step alone, a tie at one level, a word no record ends with', () => {
    expect(classOwnFeatureId('weapon-specialization', 'fighter', c)).toBe('weapon-specialization');
    const wiz = c.classes.wizard;
    const plant = (features: { level: number; featureId: string }[]) => ({ ...c, classes: { ...c.classes, wizard: { ...wiz, features } } }) as ContentDatabase;
    expect(classOwnFeatureId('weapon-specialization', 'wizard', plant([{ level: 15, featureId: 'greater-weapon-specialization' }]))).toBe('weapon-specialization');
    expect(classOwnFeatureId('evasion', 'wizard', plant([{ level: 7, featureId: 'confident-evasion' }, { level: 7, featureId: 'assured-evasion' }]))).toBe('evasion');
    expect(classOwnFeatureId('evasion', 'wizard', plant([{ level: 13, featureId: 'assured-evasion' }, { level: 7, featureId: 'confident-evasion' }]))).toBe('confident-evasion');
    expect(classOwnFeatureId('cause', 'bard', c)).toBe('cause');
  });
});

/**
 * The sweep the checker asked for: every classFeatures link on every class page (public/ast/classes.json.gz),
 * opened the way the card opens it (classOwnFeatureId, then sharedFeatureFallback for that class), lands on
 * the class's own page, its paragraph of a shared record, or a record with no page — never another class's
 * page — unless it is one of the links below. Shrinks only by fixing data; the list may lose entries as the
 * data lane re-points links (an absent entry is fine), never gain one.
 */
const OTHER_CLASS_LINK_ALLOWED: Record<string, string> = {
  // A cross-reference to a feature the class does not have: the record's page is the honest answer.
  'animist|spell-repertoire': 'cross-reference ("like a spell repertoire")',
  'animist|signature-spells': 'cross-reference',
  'champion|divine-font': 'cross-reference to the cleric\'s feature',
  'psychic|occult-spellcasting': 'cross-reference to the bard\'s feature',
  // An Archives auto-link on a common word in prose — a data fix (handoff to the data lane), not a card rule.
  'bard|cause': 'prose word', 'gunslinger|cause': 'prose word', 'necromancer|cause': 'prose word',
  'summoner|cause': 'prose word', 'swashbuckler|cause': 'prose word', 'witch|cause': 'prose word',
  'gunslinger|resolve': 'prose word', 'magus|resolve': 'prose word', 'swashbuckler|resolve': 'prose word (Reinforced Ego)',
  'thaumaturge|resolve': 'prose word', 'cleric|divine-will': 'prose word', 'fighter|tactics': 'prose word',
  'guardian|second-skin': 'prose word',
};

describe('package M: no class page link opens another class\'s page', () => {
  const classTrees = JSON.parse(gunzipSync(readFileSync('public/ast/classes.json.gz')).toString('utf8')) as Record<string, AstNode>;
  const cfTrees = JSON.parse(gunzipSync(readFileSync('public/ast/classFeatures.json.gz')).toString('utf8')) as Record<string, AstNode>;
  const names = Object.values(c.classes).map((x) => x.name);

  it('every classFeatures link on a class page opens the class\'s own page, its paragraph, or a page-less record', () => {
    let links = 0;
    const offenders: string[] = [];
    for (const [clsId, tree] of Object.entries(classTrees)) {
      const cls = c.classes[clsId];
      if (!cls) continue;
      const walk = (n: AstNode) => {
        const ref = (n as { ref?: string }).ref;
        if (n.t === 'link' && typeof ref === 'string' && ref.startsWith('classFeatures:')) {
          links++;
          const id = classOwnFeatureId(ref.slice('classFeatures:'.length), clsId, c);
          const page = cfTrees[id] ? textOf(cfTrees[id]) : undefined;
          const owner = page ? pageClassName(page, names) : undefined;
          const ownParagraph = sharedFeatureFallback(id, clsId, page, c) !== null;
          if (owner && owner !== cls.name && !ownParagraph && !OTHER_CLASS_LINK_ALLOWED[`${clsId}|${ref.slice('classFeatures:'.length)}`]) {
            offenders.push(`${clsId}: "${textOf(n)}" → ${id} (page of ${owner})`);
          }
        }
        for (const k of n.c ?? []) walk(k);
      };
      walk(tree);
    }
    expect(links, 'the walk reached the class pages\' links').toBeGreaterThan(500);
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

describe('package M: the shared card\'s Source line is the class\'s own book', () => {
  it('a swashbuckler reads Player Core 2, a wizard Player Core — never the shared record\'s Dark Archive', () => {
    expect(c.classFeatures['weapon-expertise'].source?.book).toMatch(/Dark Archive/);
    expect(sharedFeatureBook('swashbuckler', c)).toBe('Pathfinder Player Core 2');
    expect(sharedFeatureBook('wizard', c)).toBe('Pathfinder Player Core');
  });

  it('no class, no book, a homebrew class: no Source line', () => {
    expect(sharedFeatureBook(undefined, c)).toBeUndefined();
    expect(sharedFeatureBook('no-such-class', c)).toBeUndefined();
    const hb = { ...c, classes: { ...c.classes, wizard: { ...c.classes.wizard, source: { book: 'My Book', license: 'homebrew' as const } } } };
    expect(sharedFeatureBook('wizard', hb as ContentDatabase)).toBeUndefined();
    const blank = { ...c, classes: { ...c.classes, wizard: { ...c.classes.wizard, source: { book: '  ' } } } };
    expect(sharedFeatureBook('wizard', blank as ContentDatabase)).toBeUndefined();
  });
});
