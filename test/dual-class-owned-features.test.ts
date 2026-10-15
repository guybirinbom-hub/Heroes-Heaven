// @vitest-environment jsdom
/*
 * DUAL CLASS — the second class's FEATURES are the character's.
 *
 * bug 2026-10-14 (the owner's list): a Fighter/Guardian woke Fatigued after sleeping in full plate,
 * although the Guardian's own Guardian's Armor lets them rest in medium and heavy armour. Cause: the
 * sheet's owned-feature set (derive.ts `ownedFeatureIds`) walked the FIRST class's table alone. It
 * reached the second class's SUBCLASS but none of its features, so every reader behind it — rest,
 * resistances, actions, modes, situational stars, strike riders — saw a Fighter/Guardian as a fighter.
 * The Dual Class rule prints the opposite: *"gain the proficiencies, HP, features and feats of a second
 * class"* (types.ts VariantRules.dualClass).
 *
 * The same root cause sat in a family of other readers, each asking "which class?" of `classId` alone:
 * weapon specialization, runic optimization, Rage, the rogue's rackets, crit specialization, the
 * champion's Cause card, the summoner's eidolon card, the signature-spell toggle, the at-your-level card
 * line — and, at BUILD time, every owned-feature lane in buildCharacter (feat picks, feat grants,
 * proficiency grants, grant modifications, spell-list widenings, rituals, tokens, the feature-answer
 * carrier, granted Strikes). All now ask derive.ts `heldClasses` / `heldClassFeatureIds`, which name the
 * second class only under the Dual Class rule.
 *
 * Every case below asserts a real number or a real row, and a control beside it, so a build that
 * simply rendered nothing can never read as a pass.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { build, content, firstSubclass } from './_content';
import { renderDom } from './_render';
import {
  buildCharacter,
  deriveBuildFromCharacter,
  effectChoiceOffered,
  emptyBuild,
  levelChoices,
  levelGrants,
  qiSpellsPossible,
  signatureSpellsAt,
  type BuildState,
} from '../src/rules/build';
import { traditionPool } from '../src/rules/spellOptions';
import {
  classFeatureIdsOwned,
  critSpecSources,
  deriveDefenses,
  deriveStrikes,
  entryClassIdOf,
  heldClasses,
  ownedFeatureIds,
  specDamageParts,
  weaponSpecialization,
} from '../src/rules/derive';
import { explainStat } from '../src/rules/explain';
import { Builder } from '../src/builder/Builder';
import { MainTab } from '../src/sheet/MainTab';
import { fatiguingArmor, ownedRestIds } from '../src/rules/play';
import { FEAT_PICK_GRANTS, pickableFeats } from '../src/rules/featPickGrants';
import { atLevelLines } from '../src/sheet/cardAtLevel';
import { SpellsTab } from '../src/sheet/SpellsTab';
import { VitalsRail } from '../src/sheet/VitalsRail';
import { CompanionsTab } from '../src/sheet/CompanionsTab';
import { FeatsTab, featEntries } from '../src/sheet/FeatsTab';
import type { Character, ContentDatabase, InventoryItem } from '../src/rules/types';

const db = content();
const noop = () => undefined;

/** A dual-class character: `a` first, `b` second, each on its first subclass unless overridden. */
const dual = (a: string, b: string, level: number, over: Partial<BuildState> = {}): Character =>
  build(a, level, { variantRules: { dualClass: true }, classId2: b, subclassId2: firstSubclass(b), ...over });

/** The same BuildState `build()` makes, for the cases that need a patched database. */
const dualState = (a: string, b: string, level: number, over: Partial<BuildState> = {}): BuildState => {
  const cls = db.classes[a];
  return {
    ...emptyBuild(),
    name: 't',
    level,
    classId: a,
    ancestryId: Object.keys(db.ancestries)[0],
    backgroundId: Object.keys(db.backgrounds)[0],
    keyAbility: (cls && cls.keyAbility.length === 1 ? cls.keyAbility[0] : null) as BuildState['keyAbility'],
    subclassId: firstSubclass(a),
    variantRules: { dualClass: true },
    classId2: b,
    subclassId2: firstSubclass(b),
    ...over,
  };
};

const row = (itemId: string, over: Partial<InventoryItem> = {}): InventoryItem => ({ instanceId: `i-${itemId}`, itemId, quantity: 1, ...over });
const wielding = (ch: Character, ...itemIds: string[]): Character => ({ ...ch, inventory: [...ch.inventory, ...itemIds.map((id) => row(id, { equipped: true }))] });
const raging = (ch: Character): Character => ({ ...ch, classResources: { ...(ch.classResources ?? {}), rage: 1 } }) as Character;
const strike = (ch: Character, name: string) => deriveStrikes(ch, db).find((s) => s.name === name);
const riders = (ch: Character, name: string) => strike(ch, name)?.conditionalDamage ?? [];

describe('the reported bug: a Fighter/Guardian rests normally in full plate', () => {
  it('owns Guardian\'s Armor, so full plate is not armour that fatigues them', () => {
    const fg = dual('fighter', 'guardian', 5);
    expect(ownedFeatureIds(fg, db).has('guardians-armor')).toBe(true);
    expect(fatiguingArmor([row('full-plate', { worn: true })], db.items, ownedRestIds(fg, db))).toBeUndefined();
    // Control: the same suit DOES fatigue a plain fighter, so the case above is not vacuous.
    expect(fatiguingArmor([row('full-plate', { worn: true })], db.items, ownedRestIds(build('fighter', 5), db))?.id).toBe('full-plate');
  });

  it('…and its resistance reaches the sheet in that armour', () => {
    const fg = { ...dual('fighter', 'guardian', 5), inventory: [row('full-plate', { worn: true })] };
    expect(deriveDefenses(fg, db).resistances.some((r) => r.type === 'physical' && r.value > 0)).toBe(true);
  });
});

describe('every feature of the second class is owned', () => {
  const pairs: [string, string][] = [['fighter', 'guardian'], ['wizard', 'cleric'], ['fighter', 'rogue']];
  for (const [a, b] of pairs) {
    it(`${a}/${b} at 20th owns all of ${b}'s table, variants and subclass — and keeps all of ${a}'s`, () => {
      const ch = dual(a, b, 20);
      const owned = ownedFeatureIds(ch, db);
      const second = classFeatureIdsOwned({ classId: b, subclassId: ch.subclassId2, level: 20 }, db);
      const first = classFeatureIdsOwned({ classId: a, subclassId: ch.subclassId, level: 20 }, db);
      expect(second.size, `${b} has features to own`).toBeGreaterThan(5);
      expect([...second].filter((id) => !owned.has(id))).toEqual([]);
      expect([...first].filter((id) => !owned.has(id))).toEqual([]);
    });
  }

  it('with Dual Class OFF a second class grants nothing — not its table, not its subclass', () => {
    // buildCharacter drops `classId2` when the rule is off…
    const off = build('fighter', 5, { classId2: 'guardian', subclassId2: firstSubclass('guardian') });
    for (const id of ['guardians-armor', 'taunt', 'tough-to-kill']) expect(ownedFeatureIds(off, db).has(id), id).toBe(false);
    expect(off.feats.some((f) => f.featId === 'diehard'), 'no Tough to Kill Diehard').toBe(false);
    // …and derive itself guards too: a stored character with the rule switched off owns none of the
    // second class's TABLE. (Its subclass row also rides on the built `classChoices`, which only a build
    // with the rule on writes — so that half is buildCharacter's, asserted on `off` above.)
    const fr = dual('fighter', 'rogue', 5);
    const stale = { ...fr, variantRules: { ...fr.variantRules, dualClass: false } } as Character;
    expect(heldClasses(stale)).toHaveLength(1);
    for (const id of ['sneak-attack', 'rogues-racket', 'deny-advantage']) expect(ownedFeatureIds(stale, db).has(id), id).toBe(false);
    expect(ownedFeatureIds(fr, db).has('sneak-attack'), 'the control owns it').toBe(true);
    expect(ownedFeatureIds(off, db).has(firstSubclass('guardian') ?? 'none'), 'nor the subclass, built with the rule off').toBe(false);
  });

  it('a Guardian/Fighter (the other order) owns the fighter\'s features and their crit specialization', () => {
    const gf = dual('guardian', 'fighter', 5);
    for (const id of ['bravery', 'reactive-strike', 'fighter-weapon-mastery']) expect(ownedFeatureIds(gf, db).has(id), id).toBe(true);
    expect(critSpecSources(gf, db).length).toBeGreaterThan(critSpecSources(build('guardian', 5), db).length);
  });
});

describe('strike math reads the second class', () => {
  it('a Fighter/Rogue\'s Strike against an off-guard target gets Sneak Attack, at the rogue\'s scale', () => {
    const fr = wielding(dual('fighter', 'rogue', 5), 'dagger');
    expect(riders(fr, 'Dagger')).toContainEqual({ text: '2d6 precision', note: 'sneak attack when target is off-guard' });
    expect(riders(wielding(build('fighter', 5), 'dagger'), 'Dagger').some((r) => /sneak attack/.test(r.note))).toBe(false);
  });

  it('…and the second class\'s RACKET counts: a ruffian Fighter/Rogue sneak-attacks with a mace, a thief does not', () => {
    const ruffian = wielding(dual('fighter', 'rogue', 5, { subclassId2: 'ruffian' }), 'mace');
    const thief = wielding(dual('fighter', 'rogue', 5, { subclassId2: 'thief' }), 'mace');
    expect(riders(ruffian, 'Mace').some((r) => /sneak attack/.test(r.note))).toBe(true);
    expect(riders(thief, 'Mace').some((r) => /sneak attack/.test(r.note))).toBe(false);
  });

  it('a Wizard/Fighter has Weapon Specialization at 7th, as a Fighter/Wizard does', () => {
    const wf = dual('wizard', 'fighter', 7);
    expect(weaponSpecialization(wf, db).spec).toBe(true);
    expect(weaponSpecialization(dual('fighter', 'wizard', 7), db).spec).toBe(true);
    expect(strike(wielding(wf, 'longsword'), 'Longsword')?.specDamage).toBe(2);
    expect(weaponSpecialization(build('wizard', 7), db).spec, 'control: a wizard alone has none').toBe(false);
  });

  it('an X/Barbarian rages for its instinct\'s damage — and the card\'s at-your-level line says so', () => {
    const wb = dual('wizard', 'barbarian', 7, { subclassId2: 'fury-instinct' });
    const rage = riders(raging(wielding(wb, 'longsword')), 'Longsword').find((r) => /^\* while raging/.test(r.note));
    expect(rage?.text).toBe('7 slashing');
    expect(riders(wielding(wb, 'longsword'), 'Longsword').some((r) => /while raging/.test(r.note)), 'not raging: no rider').toBe(false);
    expect(atLevelLines(wb, db, 'classFeatures', 'fury-instinct').map((l) => l.text).join(' ')).toContain('Fist: 3 bludgeoning');
  });

  it('an X/Runesmith reaches Runic Optimization', () => {
    const fr = dual('fighter', 'runesmith', 9);
    const ls = strike({ ...fr, inventory: [row('longsword', { equipped: true, runes: { potency: 1, striking: 'striking' } })] }, 'Longsword');
    const plain = strike({ ...build('fighter', 9), inventory: [row('longsword', { equipped: true, runes: { potency: 1, striking: 'striking' } })] }, 'Longsword');
    expect((ls?.specDamage ?? 0) - (plain?.specDamage ?? 0)).toBe(2);
  });
});

describe('buildCharacter hands over what a second class\'s feature grants', () => {
  it('feat-grant queue: a Fighter/Guardian\'s Tough to Kill grants Diehard (dying 5)', () => {
    const fg = dual('fighter', 'guardian', 5);
    expect(fg.feats).toContainEqual(expect.objectContaining({ featId: 'diehard', grantedBy: 'tough-to-kill' }));
    expect(fg.dyingThreshold).toBe(5);
  });

  it('feature feat picks: an X/Summoner\'s evolution feat is kept', () => {
    const state = dualState('fighter', 'summoner', 1);
    const pick = pickableFeats(FEAT_PICK_GRANTS['evolution-feat'], state, db)[0]?.id;
    expect(pick, 'the summoner offers an evolution feat').toBeTruthy();
    const ch = buildCharacter({ ...state, pickFeatChoices: { 'evolution-feat': pick! } }, db);
    expect(ch.feats).toContainEqual(expect.objectContaining({ featId: pick, grantedBy: 'evolution-feat' }));
  });

  it('effect-choice feat grants: a Fighter/Kineticist\'s fire skill junction grants Intimidating Glare', () => {
    const ch = dual('fighter', 'kineticist', 5, { effectChoices: { 'gates-threshold:gate-junction': 'fire-skill-junction' } });
    expect(ch.feats).toContainEqual(expect.objectContaining({ featId: 'intimidating-glare', grantedBy: 'gates-threshold' }));
  });

  it('proficiency grants: a Fighter/Inventor\'s Overdrive features raise Crafting as an Inventor\'s do', () => {
    // Expert Overdrive (3rd) → expert, Master Overdrive (7th) → master; the class only TRAINS it.
    expect(dual('fighter', 'inventor', 3).proficiencies.skills.crafting).toBe('expert');
    const fi = dual('fighter', 'inventor', 7);
    expect(fi.proficiencies.skills.crafting).toBe('master');
    expect(fi.proficiencies.skills.crafting).toBe(build('inventor', 7).proficiencies.skills.crafting);
  });

  it('spell-list widening: a Fighter/Cleric\'s Deity adds the deity\'s spells to the CLERIC list', () => {
    const deity = Object.values(db.deities).find((d) => (d.spells ?? []).length >= 2 && (d.divineFont ?? []).length)!;
    const fc = dual('fighter', 'cleric', 1, { deityId: deity.id });
    const want = (deity.spells ?? []).filter((s) => db.spells[s]);
    expect(want.length).toBeGreaterThan(0);
    expect(fc.spellListAdditions?.['cleric-casting'] ?? []).toEqual(expect.arrayContaining(want));
  });

  it('…and an UNSCOPED widening of a second-class-only feature is aimed at the second class\'s entry', () => {
    const cs = dual('cleric', 'summoner', 1, { subclassId2: 'fey-eidolon' });
    const fey = (cs.spellListTraditions ?? []).filter((w) => w.traditions.includes('arcane'));
    expect(fey).toHaveLength(1);
    expect(fey[0].entryId).toBe('summoner-casting');
    // A single-class Summoner keeps the unscoped row, exactly as before.
    const s = build('summoner', 1, { subclassId: 'fey-eidolon' });
    expect((s.spellListTraditions ?? []).filter((w) => w.traditions.includes('arcane')).map((w) => w.entryId)).toEqual([undefined]);
  });

  /*
   * lane A check 2: the widening was aimed only when the feature was the SECOND class's, so the same
   * Fey Eidolon on a Summoner/Cleric (summoner FIRST) stayed unscoped, and spellOptions applies an
   * unscoped widening to every entry — the cleric list was offered 123 arcane-only illusion and mental
   * spells. Either order now aims a one-class feature at that class's own entry.
   */
  it('…in EITHER class order: a Summoner(fey)/Cleric\'s cleric list gets none of the arcane illusions', () => {
    const arcaneOnlyFey = (ch: Character, entryId: string) => {
      const entry = ch.spellcasting.find((e) => e.id === entryId)!;
      return Object.values(traditionPool(ch, entry, db).byRank)
        .flat()
        .filter((sp) => !sp.traditions.includes(entry.tradition) && sp.traditions.includes('arcane'));
    };
    const sc = dual('summoner', 'cleric', 1, { subclassId: 'fey-eidolon', subclassId2: 'cloistered-cleric' });
    const fey = (sc.spellListTraditions ?? []).filter((w) => w.from === 'Fey Eidolon');
    expect(fey.map((w) => w.entryId)).toEqual(['summoner-casting']);
    expect(arcaneOnlyFey(sc, 'cleric-casting')).toEqual([]);
    // Control: the summoner's own list does get them, so the cleric's empty list is not a vacuous pass.
    expect(arcaneOnlyFey(sc, 'summoner-casting').length).toBeGreaterThan(20);
  });

  it('the feature-answer carrier: an X/Barbarian\'s element reaches the sheet, and Rage deals that type', () => {
    const fb = dual('fighter', 'barbarian', 1, { subclassId2: 'elemental-instinct', featChoices: { 'feature:elemental-instinct': 'air-slashing' } });
    expect(fb.featureChoices?.['feature:elemental-instinct']).toBe('air-slashing');
    const rage = riders(raging(wielding(fb, 'longsword')), 'Longsword').find((r) => /^\* while raging/.test(r.note));
    expect(rage?.text).toBe('4 slashing');
  });

  it('granted Strikes: a Fighter/Magus (Unfurling Brocade) gets the qi-infused fabric, and a round trip does not duplicate it', () => {
    const fm = dual('fighter', 'magus', 1, { subclassId2: 'unfurling-brocade' });
    expect((fm.naturalAttacks ?? []).map((n) => n.name)).toContain('Qi-Infused Fabric');
    expect((deriveBuildFromCharacter(fm, db).naturalAttacks ?? []).map((n) => n.name)).not.toContain('Qi-Infused Fabric');
    expect((build('fighter', 1).naturalAttacks ?? []).map((n) => n.name)).not.toContain('Qi-Infused Fabric');
  });

  it('a doctrine-gated branch follows the SECOND class only while Dual Class is on', () => {
    // Syncretism's domain branch is the cloistered cleric's (`requiresFeature`); the gate walked
    // `[classId, classId2]` with no Dual Class guard, so a cleric left on the build still opened it.
    const domain = db.feats['syncretism']?.effectChoices?.find((c) => c.requiresFeature === 'cloistered-cleric');
    expect(domain, 'the gated branch exists').toBeTruthy();
    const on = dualState('fighter', 'cleric', 5, { subclassId2: 'cloistered-cleric' });
    const off = { ...on, variantRules: { dualClass: false } };
    expect(effectChoiceOffered(domain!, on, db, 'syncretism')).toBe(true);
    expect(effectChoiceOffered(domain!, off, db, 'syncretism')).toBe(false);
  });

  it('a stale second class with Dual Class OFF adds no focus point; with it ON the psychic\'s do count', () => {
    // The focus walks read `[classId, classId2]` with no Dual Class guard, so a psychic left on the build
    // after the rule was switched off still handed a wizard its psi points (measured: 3 instead of 1).
    const plain = build('wizard', 7);
    const stale = build('wizard', 7, { classId2: 'psychic', subclassId2: firstSubclass('psychic') });
    const on = dual('wizard', 'psychic', 7);
    expect(plain.focus?.max).toBe(1);
    expect(stale.focus?.max).toBe(1);
    expect(on.focus?.max).toBe(3);
  });

  /*
   * Three lanes no shipped class-table record exercises yet (grant modifications, granted rituals,
   * choice tokens). Proved on a PATCHED copy of the database: one guardian feature is given each field,
   * and a Fighter/Guardian must receive it — a lane that reads only the first class cannot.
   */
  describe('lanes no shipped record reaches yet, on a patched copy', () => {
    const ritual = Object.values(db.spells).find((s) => (s as { ritual?: boolean }).ritual)!;
    const patched = {
      ...db,
      classFeatures: {
        ...db.classFeatures,
        'guardians-armor': {
          ...db.classFeatures['guardians-armor'],
          modifiesGrant: [{ from: 'guardians-armor', actionRider: { note: 'lane-a probe' } }],
          grantsRituals: [{ spellId: ritual.id }],
          choice: { prompt: 'probe', options: [{ value: 'x', label: 'X', grantsToken: 'lane-a-token' }] },
        },
      },
    } as unknown as ContentDatabase;
    const ch = buildCharacter(dualState('fighter', 'guardian', 5, { featChoices: { 'feature:guardians-armor': 'x' } }), patched);

    it('grant modifications', () => {
      expect(ch.grantMarkers?.['guardians-armor']?.some((m) => m.note === 'lane-a probe')).toBe(true);
    });
    it('granted rituals', () => {
      expect((ch.grantedRituals ?? []).map((r) => r.spellId)).toContain(ritual.id);
    });
    it('choice tokens', () => {
      expect(ch.choiceTokens ?? []).toContain('lane-a-token');
    });
  });
});

describe('the sheet\'s class-specific cards read the second class', () => {
  it('the Spells tab offers a signature toggle on a Fighter/Bard\'s bard repertoire', () => {
    const fb = dual('fighter', 'bard', 5);
    const entry = fb.spellcasting.find((e) => e.id === 'bard-casting');
    expect(entry, 'the bard entry exists').toBeTruthy();
    expect(entryClassIdOf(fb, entry!)).toBe('bard');
    expect(signatureSpellsAt(db.classes[entryClassIdOf(fb, entry!)!], 5)).toBe(true);
    const ch = { ...fb, spellcasting: fb.spellcasting.map((e) => (e.id === 'bard-casting' ? { ...e, repertoire: { ...(e.repertoire ?? {}), 1: ['soothe'] } } : e)) };
    const r = renderDom(createElement(SpellsTab, { character: ch, content: db, onPlay: noop }));
    r.click([...r.host.querySelectorAll('button.ms-btn')][0] ?? null);
    const slots = document.querySelectorAll('.ms-slot').length;
    const stars = document.querySelectorAll('button.ms-sig').length;
    r.stop();
    expect(slots, 'the repertoire row is on the page').toBeGreaterThan(0);
    expect(stars).toBe(slots);
  });

  it('the rail shows an X/Champion\'s Cause', () => {
    const fc = dual('fighter', 'champion', 5);
    const cause = db.classFeatures[fc.subclassId2!]?.name;
    expect(cause).toBeTruthy();
    const r = renderDom(createElement(VitalsRail, { character: fc, content: db }));
    const cards = [...r.host.querySelectorAll('section.card')].map((s) => s.textContent ?? '');
    r.stop();
    expect(cards.some((t) => t.includes('Cause') && t.includes(cause!))).toBe(true);
  });

  it('the Companions tab shows an X/Summoner\'s eidolon', () => {
    const fs = dual('fighter', 'summoner', 5);
    const r = renderDom(createElement(CompanionsTab, { character: fs, content: db }));
    const text = r.host.textContent ?? '';
    r.stop();
    const plain = renderDom(createElement(CompanionsTab, { character: build('fighter', 5), content: db }));
    const plainText = plain.host.textContent ?? '';
    plain.stop();
    expect(/eidolon/i.test(text)).toBe(true);
    expect(/eidolon/i.test(plainText), 'control: a fighter has none').toBe(false);
  });
});

/*
 * The second subclass's own QUESTION (lane A check, 2026-10-14). The builder asked only the FIRST
 * subclass's follow-up (Builder.tsx, the level page), so a Fighter/Barbarian could not name its element,
 * animal, dragon or giant energy — its Rage read "energy" and an animal instinct had no animal attack —
 * and the two cases above passed only because they wrote the answer straight into the build. Asked now
 * on the Level 0 page under the second-class card (`renderSecondSubclassAsks`), through the real Builder.
 */
describe('the builder asks the SECOND subclass\'s own question', () => {
  afterEach(() => {
    for (const n of [...document.body.children]) n.remove();
  });
  const flush = () => act(async () => void (await new Promise((res) => setTimeout(res, 0))));
  function open(initial: BuildState) {
    let saved: BuildState | null = null;
    const r = renderDom(createElement(Builder, { content: db, initial, onCancel: noop, onCreate: (b: BuildState) => void (saved = b) }));
    const lvl0 = [...r.host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === '0');
    expect(lvl0, 'the Level 0 page').toBeTruthy();
    r.click(lvl0!);
    return { r, saved: () => saved };
  }
  const cardOf = (r: ReturnType<typeof renderDom>, name: string) => r.host.querySelector(`[data-setupcard="Dual Class — ${name}"]`);
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === label) ?? null;

  it('a Fighter/Barbarian (elemental instinct) names its element there, and its Rage deals that type', async () => {
    const h = open(dualState('fighter', 'barbarian', 1, { subclassId2: 'elemental-instinct' }));
    const card = cardOf(h.r, db.classFeatures['elemental-instinct'].name);
    expect(card, 'the second subclass asks its question on the Level 0 page').toBeTruthy();
    const ctl = card!.querySelector('[data-ctl-title="Element (and damage type)"]');
    expect(ctl, 'the element picker').toBeTruthy();
    h.r.click(ctl!.querySelector('.ss-replace') ?? ctl!);
    await flush();
    const item = [...document.querySelectorAll('.picker-overlay .pick-row, .picker-overlay .picker-item')].find(
      (x) => (x.querySelector('.picker-name')?.textContent ?? '').trim() === 'Air — slashing',
    );
    expect(item, 'the "Air — slashing" option').toBeTruthy();
    h.r.click([...item!.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Select') ?? item!);
    await flush();
    h.r.click(button('Save changes'));
    await flush();
    for (let i = 0; i < 4 && button('Save anyway'); i++) {
      h.r.click(button('Save anyway'));
      await flush();
    }
    h.r.stop();
    const saved = h.saved();
    expect(saved?.featChoices['feature:elemental-instinct']).toBe('air-slashing');
    const rage = riders(raging(wielding(buildCharacter(saved!, db), 'longsword')), 'Longsword').find((r) => /^\* while raging/.test(r.note));
    expect(rage?.text).toBe('4 slashing');
  });

  it('…and nothing is asked of a second class the Dual Class rule is not on for', () => {
    const h = open(dualState('fighter', 'barbarian', 1, { subclassId2: 'elemental-instinct', variantRules: { dualClass: false } }));
    const card = cardOf(h.r, db.classFeatures['elemental-instinct'].name);
    h.r.stop();
    expect(card).toBeNull();
  });

  it('an effectChoices question (a Fighter/Rogue mastermind\'s skill) and a bonus-feat pick (fury instinct) are asked too', () => {
    const fr = open(dualState('fighter', 'rogue', 1, { subclassId2: 'mastermind' }));
    const mastermind = cardOf(fr.r, db.classFeatures['mastermind'].name);
    const skill = mastermind?.querySelector('[data-ctl-title="Choose the skill your Mastermind racket makes you trained in"]');
    fr.r.stop();
    expect(skill, 'the mastermind skill picker').toBeTruthy();
    const fb = open(dualState('fighter', 'barbarian', 1, { subclassId2: 'fury-instinct' }));
    const fury = cardOf(fb.r, db.classFeatures['fury-instinct'].name);
    const feat = fury?.querySelector('[data-ctl-title="Choose a 1st-level barbarian feat"]');
    fb.r.stop();
    expect(feat, 'the fury instinct bonus-feat picker').toBeTruthy();
  });
});

/*
 * The damage label names BOTH features that paid it (lane A check, 2026-10-14). deriveStrike folds Weapon
 * Specialization and Runic Optimization into one `specDamage`, and every label read `classId ===
 * 'runesmith'` — so a Fighter/Runesmith's +4 was "Weapon specialization", and the Weapon Specialization
 * card's at-your-level line counted the Runic Optimization half as its own.
 */
describe('the spec-damage label names each feature that paid it', () => {
  const striking = (ch: Character): Character => ({ ...ch, inventory: [row('longsword', { equipped: true, runes: { potency: 1, striking: 'striking' } })] });
  const labelled = (ch: Character) => {
    const s = strike(striking(ch), 'Longsword')!;
    return { s, parts: specDamageParts(striking(ch), db, s) };
  };

  it('a Fighter/Runesmith at 9th: weapon specialization 2 and Runic Optimization 2, in the breakdown and the tooltip', () => {
    const fr = dual('fighter', 'runesmith', 9);
    const { s, parts } = labelled(fr);
    expect(s.specDamage).toBe(4);
    expect(parts).toEqual([{ label: 'Weapon specialization', value: 2 }, { label: 'Runic Optimization', value: 2 }]);
    const breakdown = explainStat(striking(fr), db, { kind: 'strikeDamage', instanceId: s.instanceId }).parts;
    expect(breakdown).toContainEqual({ label: 'Weapon specialization', value: 2 });
    expect(breakdown).toContainEqual({ label: 'Runic Optimization', value: 2 });
    const r = renderDom(createElement(MainTab, { character: striking(fr), content: db, onPlay: noop }));
    const titles = [...r.host.querySelectorAll('[title$="(included in the damage above)"]')].map((e) => e.getAttribute('title'));
    r.stop();
    expect(titles).toContain('Weapon specialization +2 and Runic Optimization +2 (included in the damage above)');
  });

  it('…and the Weapon Specialization card says 2, not the 4 Runic Optimization shares with it', () => {
    const line = (ch: Character) => atLevelLines(striking(ch), db, 'classFeatures', 'weapon-specialization').map((l) => l.text).join(' ');
    // The Fighter/Runesmith's Weapon Specialization line reads exactly as a plain fighter's does.
    expect(line(dual('fighter', 'runesmith', 9))).toBe(line(build('fighter', 9)));
    expect(line(build('fighter', 9))).toMatch(/2 extra damage with [^;]*Longsword/);
    expect(line(dual('fighter', 'runesmith', 9))).not.toContain('4 extra damage');
  });

  it('one class keeps one label: a runesmith\'s is Runic Optimization, a fighter\'s weapon specialization', () => {
    expect(labelled(build('runesmith', 9)).parts).toEqual([{ label: 'Runic Optimization', value: 2 }]);
    expect(labelled(build('fighter', 9)).parts).toEqual([{ label: 'Weapon specialization', value: 2 }]);
  });
});

/*
 * A second class LEFT ON THE BUILD after Dual Class was turned off is no class (lane A check 2). Turning
 * the rule off does not clear `classId2`/`subclassId2`, and a dozen build.ts reads compared them raw —
 * measured over every class pair at 5th and 13th: 56 builds kept the fighter's weapon-group mastery, 12
 * kept a ruffian/avenger's medium armour, 56 were still asked the monk's qi tradition and 504 still owed
 * the stale class's own choices (apparitions, ikons, kinetic gates). Each read now asks derive.ts
 * `holdsClass` / `holdsSubclass` / `heldClasses`. Every case has the rule-ON twin beside it.
 */
describe('a second class left on the build with Dual Class OFF grants nothing', () => {
  const off = (a: string, b: string, level: number, over: Partial<BuildState> = {}): Character =>
    build(a, level, { classId2: b, subclassId2: firstSubclass(b), ...over });

  it('no fighter weapon-group mastery for a wizard', () => {
    expect(off('wizard', 'fighter', 5, { fighterWeaponGroup: 'sword' }).proficiencies.weaponGroupRanks).toBeUndefined();
    expect(dual('wizard', 'fighter', 5, { fighterWeaponGroup: 'sword' }).proficiencies.weaponGroupRanks).toContainEqual({ group: 'sword', category: 'martial', rank: 'master' });
  });

  it('no ruffian medium armour for a bard', () => {
    expect(off('bard', 'rogue', 13, { subclassId2: 'ruffian' }).proficiencies.defenses.medium).toBe(build('bard', 13).proficiencies.defenses.medium);
    expect(dual('bard', 'rogue', 13, { subclassId2: 'ruffian' }).proficiencies.defenses.medium).toBe('expert');
  });

  it('no cleric deity skill for a wizard', () => {
    const deity = Object.values(db.deities).find((d) => d.skill === 'athletics')!;
    expect(deity, 'a deity granting Athletics').toBeTruthy();
    expect(build('wizard', 5, { deityId: deity.id }).proficiencies.skills.athletics ?? 'untrained').toBe('untrained');
    expect(off('wizard', 'cleric', 5, { deityId: deity.id, subclassId2: 'cloistered-cleric' }).proficiencies.skills.athletics ?? 'untrained').toBe('untrained');
    expect(dual('wizard', 'cleric', 5, { deityId: deity.id, subclassId2: 'cloistered-cleric' }).proficiencies.skills.athletics).toBe('trained');
  });

  it('no monk qi question and no kineticist gate owed', () => {
    const stale = (a: string, b: string, level: number): BuildState => ({ ...dualState(a, b, level), variantRules: { dualClass: false } });
    expect(qiSpellsPossible(stale('wizard', 'monk', 5), db)).toBe(false);
    expect(qiSpellsPossible(dualState('wizard', 'monk', 5), db)).toBe(true);
    const gate = (b: BuildState) => levelChoices(b, db).map((m) => m.label).filter((l) => /Kinetic Gate/.test(l));
    expect(gate(stale('alchemist', 'kineticist', 5))).toEqual([]);
    expect(gate(dualState('alchemist', 'kineticist', 5))).toHaveLength(1);
  });

  /* The sweep that catches the NEXT raw `classId2` read wherever it is: for every ordered class pair,
   * the build with the stale second class is the plain build, byte for byte, and so are the builder's
   * own helpers. Measured before the fix: 622 of 1,624 differed. */
  it('every class pair at 5th and 13th: a stale second class changes nothing at all', () => {
    const classes = Object.keys(db.classes).sort();
    const deity = Object.values(db.deities).find((d) => d.skill === 'athletics')!;
    const helpers = (s: BuildState) => JSON.stringify([levelChoices(s, db), qiSpellsPossible(s, db)]);
    const differing: string[] = [];
    let compared = 0;
    for (const a of classes) {
      const base: Partial<BuildState> = { fighterWeaponGroup: 'sword', deityId: deity.id, pathToPerfection: ['fortitude', null, null] };
      for (const level of [5, 13]) {
        const plain = JSON.stringify(build(a, level, base));
        const plainHelpers = helpers({ ...dualState(a, a, level, base), classId2: null, subclassId2: null, variantRules: {} });
        for (const b of classes) {
          if (b === a) continue;
          const over = { ...base, classId2: b, subclassId2: firstSubclass(b) };
          compared++;
          const stale = { ...dualState(a, b, level, over), variantRules: {} };
          if (JSON.stringify(build(a, level, over)) !== plain || helpers(stale) !== plainHelpers) differing.push(`${a}+${b}@${level}`);
        }
      }
    }
    expect(compared).toBeGreaterThan(1000);
    expect(differing).toEqual([]);
  });

  /* …and the reads the sweep cannot run: the builder's components and derive's Character readers. A raw
   * comparison against `classId2`/`subclassId2` (or a `[classId, classId2]` pair) must sit on a line
   * that guards it — `dualClass`, or an already-guarded `cls2…` — or go through `holdsClass` /
   * `holdsSubclass` / `heldClasses`. Comment lines are skipped.
   *
   * `!==` as well as `===`, on both sides, and through a template literal (lane C2, from lane A check
   * 3): `add.entryId !== `${build.classId2}-casting`` slipped past the `===`-only pattern — an unguarded
   * read that let a widening aimed at the second class's pool widen the first class's picker. A test
   * against `undefined`/`null` asks whether the field is there at all (deriveBuildFromCharacter copying
   * it back), not which class it names, and is not a read of this kind. */
  it('no unguarded classId2/subclassId2 comparison anywhere in src/', () => {
    const raw =
      /\b(classId2|subclassId2)\s*[!=]==(?!\s*(?:undefined|null)\b)|[!=]==\s*`?(?:[^`]*\$\{)?[\w.?]*\b(classId2|subclassId2)\b|\[\s*[\w.]*\bclassId\s*,\s*[\w.]*\bclassId2\s*\]|\[\s*[\w.]*\bsubclassId\s*,\s*[\w.]*\bsubclassId2\s*\]|includes\(\s*[\w.]*\b(classId2|subclassId2)\b/;
    // The pattern itself, on the line it missed and on its two plain shapes, so a later edit cannot
    // quietly blunt it — and the presence test it deliberately leaves alone.
    expect(raw.test('if (add.entryId && add.entryId !== `${build.classId}-casting` && add.entryId !== `${build.classId2}-casting`) continue;')).toBe(true);
    expect(raw.test('if (b.classId2 !== x) return;')).toBe(true);
    expect(raw.test('if (x !== build.subclassId2) return;')).toBe(true);
    expect(raw.test('if (c.classId2 !== undefined) b.classId2 = c.classId2;')).toBe(false);
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? walk(join(dir, d.name)) : /\.(ts|tsx)$/.test(d.name) ? [join(dir, d.name)] : [],
      );
    const hits: string[] = [];
    for (const file of walk('src')) {
      readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          const code = line.trim();
          if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return;
          if (raw.test(code) && !/dualClass|\bcls2\w*\b/.test(code)) hits.push(`${file.replace(/\\/g, '/')}:${i + 1}: ${code.slice(0, 120)}`);
        });
    }
    expect(hits).toEqual([]);
  });
});

/*
 * The SECOND class's subclass set the FIRST class's casting (lane A check 2). The first entry took its
 * tradition and key attribute from "the first chosen option that has one" across BOTH classes, so when
 * the first class's own option was silent the second's answered: measured over every caster x every
 * tradition- or key-setting option at 5th level, 336 pairs cast in the wrong tradition and 41 off the
 * other class's attribute. Now read from the first class's own options (build.ts `firstClassOptions`).
 */
describe('the second class\'s subclass does not set the first class\'s casting', () => {
  const entry = (ch: Character, id: string) => ch.spellcasting.find((e) => e.id === id);

  it('a Cleric/Summoner(fey)\'s cleric list stays divine; the summoner\'s is the fey eidolon\'s primal', () => {
    const cs = dual('cleric', 'summoner', 5, { subclassId2: 'fey-eidolon' });
    expect(entry(cs, 'cleric-casting')?.tradition).toBe('divine');
    expect(entry(cs, 'summoner-casting')?.tradition).toBe('primal');
    // …and in the other order the summoner (first) still takes its own eidolon's tradition.
    expect(entry(dual('summoner', 'cleric', 5, { subclassId: 'fey-eidolon' }), 'summoner-casting')?.tradition).toBe('primal');
  });

  it('a Cleric/Witch(Baba Yaga) and a Wizard/Psychic keep their own lists', () => {
    expect(entry(dual('cleric', 'witch', 5, { subclassId2: 'baba-yaga' }), 'cleric-casting')?.tradition).toBe('divine');
    expect(entry(dual('wizard', 'psychic', 5), 'wizard-casting')?.tradition).toBe('arcane');
  });

  it('the draconic bloodline\'s dragon sets the first class\'s tradition only when it IS the first class\'s', () => {
    const wd = dual('wizard', 'sorcerer', 5, { subclassId: null, subclassId2: 'bloodline-draconic', dragonExemplar: 'divine' });
    expect(entry(wd, 'wizard-casting')?.tradition).toBe('arcane');
    expect(entry(build('sorcerer', 5, { subclassId: 'bloodline-draconic', dragonExemplar: 'divine' }), 'sorcerer-casting')?.tradition).toBe('divine');
  });

  it('a Bard/Rogue(ruffian) casts bard spells with Charisma, not the racket\'s Strength', () => {
    const br = dual('bard', 'rogue', 5, { subclassId2: 'ruffian' });
    expect(entry(br, 'bard-casting')?.keyAbility).toBe('cha');
    expect(entry(dual('cleric', 'rogue', 5, { subclassId2: 'ruffian' }), 'cleric-casting')?.keyAbility).toBe('wis');
  });
});

/*
 * DUAL CLASS + A CLASS ARCHETYPE — owner ruling 2026-10-15, in his words: *"Yes, only its own class
 * loses it."* (docs/gold-set-answers.md, "2026-10-15 · Dual Class and class archetypes".) A class
 * archetype's "you don't gain X" removes X from the class the archetype belongs to and never from the
 * other held class. Before this, derive.ts `ownedFeatureIds` and buildCharacter applied the suppressed
 * list FLAT across both classes while the Feats tab scoped it to the archetype's class: a Warrior of
 * Legend Fighter/Guardian had the Guardian's Shield Block listed on the Feats tab, owned nowhere on the
 * sheet, and no Shield Block feat. Every reader now asks one per-class answer (build.ts
 * `resolveClassArchetype(...).suppressedFor`, derive.ts `classArchetypeFor`).
 */
describe('Dual Class + a class archetype: only its own class loses what the archetype removes', () => {
  const WOL = 'warrior-of-legend-dedication';
  const WAR_MAGE = 'war-mage-dedication';
  /** The dedication in the class-feat slot of the class it restructures: slot 0 = the first class's. */
  const carry = (carrier: string, slot: 0 | 1) => ({ featPicks: { [`2:class:${slot}`]: carrier } });
  const featsTabLists = (ch: Character, classId: string, featureId: string) =>
    featEntries(ch, db).some((e) => e.isFeature && e.key === `feature:${classId}:${featureId}`);
  const hasFeat = (ch: Character, featId: string) => ch.feats.some((f) => f.featId === featId);
  const rowsAt = (b: BuildState, level: number) =>
    levelGrants(level, b.classId, db, b.subclassId, b.variantRules, b.classId2, b.subclassId2, b.mythicEnabled, Object.values(b.featPicks ?? {}).filter(Boolean) as string[], b).features.map((f) => f.id);

  it('a Fighter (Warrior of Legend)/Guardian owns the Guardian\'s Shield Block — sheet, Feats tab, feat and level page agree', () => {
    const ch = dual('fighter', 'guardian', 5, carry(WOL, 0));
    // The archetype really landed on the fighter, so the case is not vacuous.
    expect(ch.classArchetype?.classId).toBe('fighter');
    expect(ch.classArchetype?.suppressedFeatures).toContain('shield-block');
    expect(ownedFeatureIds(ch, db).has('shield-block')).toBe(true);
    // The Feats tab lists it under the Guardian and not under the fighter, the class that lost it.
    expect(featsTabLists(ch, 'guardian', 'shield-block')).toBe(true);
    expect(featsTabLists(ch, 'fighter', 'shield-block')).toBe(false);
    // The Guardian's Shield Block feature hands over the Shield Block feat.
    expect(ch.feats.find((f) => f.featId === 'shield-block')?.grantedBy).toBe('shield-block');
    // The builder's 1st-level page lists it once — the Guardian's row (a plain Fighter/Guardian lists two).
    const page = rowsAt(dualState('fighter', 'guardian', 5, carry(WOL, 0)), 1);
    expect(page.filter((id) => id === 'shield-block')).toHaveLength(1);
    expect(rowsAt(dualState('fighter', 'guardian', 5), 1).filter((id) => id === 'shield-block')).toHaveLength(2);
  });

  it('a Guardian/Fighter (Warrior of Legend on the fighter, the SECOND class) — the same answer', () => {
    const ch = dual('guardian', 'fighter', 5, carry(WOL, 1));
    expect(ch.classArchetype?.classId).toBe('fighter');
    expect(ownedFeatureIds(ch, db).has('shield-block')).toBe(true);
    expect(featsTabLists(ch, 'guardian', 'shield-block')).toBe(true);
    expect(featsTabLists(ch, 'fighter', 'shield-block')).toBe(false);
    expect(hasFeat(ch, 'shield-block')).toBe(true);
    expect(rowsAt(dualState('guardian', 'fighter', 5, carry(WOL, 1)), 1)).toContain('shield-block');
    // What the character carries out to the sheet: each class's own list.
    expect(ch.classArchetype?.byClass?.fighter?.suppressedFeatures).toEqual(['shield-block']);
    expect(ch.classArchetype?.byClass?.guardian?.suppressedFeatures).toEqual([]);
  });

  it('control: a single-class Warrior of Legend fighter still loses Shield Block, and so does a Fighter (WoL)/Wizard', () => {
    for (const ch of [build('fighter', 5, carry(WOL, 0)), dual('fighter', 'wizard', 5, carry(WOL, 0))]) {
      expect(ch.classArchetype?.suppressedFeatures).toContain('shield-block');
      expect(ownedFeatureIds(ch, db).has('shield-block')).toBe(false);
      expect(featsTabLists(ch, 'fighter', 'shield-block')).toBe(false);
      expect(hasFeat(ch, 'shield-block')).toBe(false);
    }
    expect(rowsAt({ ...dualState('fighter', 'guardian', 5, carry(WOL, 0)), variantRules: {}, classId2: null, subclassId2: null }, 1)).not.toContain('shield-block');
    // …and the plain fighter, for contrast, does own it.
    expect(ownedFeatureIds(build('fighter', 5), db).has('shield-block')).toBe(true);
  });

  // mutation-proof
  it('the Feats tab\'s "Class archetype" note does not call a feature "Replaced" while the other class still gives it', () => {
    /* Lane D check round 1 (low): the note read the flat suppressed list, so a Fighter (Warrior of
     * Legend)/Guardian read "Replaced: Shield Block" on the same page that lists the Guardian's Shield
     * Block row. */
    const noteOf = (ch: Character) => {
      const r = renderDom(createElement(FeatsTab, { character: ch, content: db, onPlay: noop }));
      try {
        return (r.host.querySelector('.ff-arch')?.textContent ?? '').replace(/\s+/g, ' ');
      } finally {
        r.stop();
      }
    };
    expect(noteOf(dual('fighter', 'guardian', 5, carry(WOL, 0)))).not.toMatch(/Replaced: [^.]*Shield Block/);
    // Control: the single-class Warrior of Legend fighter really did lose it, and the note says so.
    expect(noteOf(build('fighter', 5, carry(WOL, 0)))).toMatch(/Replaced: [^.]*Shield Block/);
  });

  it('a Wizard (War Mage)/Witch keeps the witch\'s Defensive Robes, and a Witch/Wizard (War Mage)\'s timeline still shows it', () => {
    const ww = dual('wizard', 'witch', 13, carry(WAR_MAGE, 0));
    expect(ww.classArchetype?.suppressedFeatures).toContain('defensive-robes');
    expect(ownedFeatureIds(ww, db).has('defensive-robes')).toBe(true);
    expect(featsTabLists(ww, 'witch', 'defensive-robes')).toBe(true);
    expect(featsTabLists(ww, 'wizard', 'defensive-robes')).toBe(false);
    // The witch as FIRST class: explain's advancement timeline is the first class's, and it lost the
    // witch's 13th-level Defensive Robes step to the wizard's archetype.
    const wi = dual('witch', 'wizard', 13, carry(WAR_MAGE, 1));
    const timeline = explainStat(wi, db, { kind: 'ac' } as never).timeline ?? [];
    expect(timeline.some((t) => t.level === 13 && t.detail === 'Defensive robes')).toBe(true);
    // Control: a single-class War Mage still has no Defensive Robes at all.
    const wm = build('wizard', 13, carry(WAR_MAGE, 0));
    expect(ownedFeatureIds(wm, db).has('defensive-robes')).toBe(false);
    expect(featsTabLists(wm, 'wizard', 'defensive-robes')).toBe(false);
  });

  /*
   * The ADVANCEMENT half: a row is its feature's proficiency step, so class 2's step must survive class
   * 1's archetype. No shipped archetype removes a feature whose step the other class's table also takes
   * at a rank nothing else gives (War Mage's own 11th-level armour step masks the witch's Defensive
   * Robes), so this is proved on a PATCHED Warrior of Legend that also removes `battle-hardened` — the
   * Fortitude master step both the fighter (9th) and the Guardian (9th) take.
   */
  describe('a second class\'s advancement row is not suppressed by the first class\'s archetype (patched copy)', () => {
    const patched = {
      ...db,
      feats: {
        ...db.feats,
        [WOL]: { ...db.feats[WOL], classArchetype: { ...db.feats[WOL].classArchetype!, suppressFeatures: ['shield-block', 'battle-hardened'] } },
      },
    } as unknown as ContentDatabase;
    const fort = (b: BuildState) => buildCharacter(b, patched).proficiencies.saves.fortitude;
    it('Fighter (WoL)/Guardian and Guardian/Fighter (WoL) reach master Fortitude from the Guardian at 9th', () => {
      expect(fort(dualState('fighter', 'guardian', 9, carry(WOL, 0)))).toBe('master');
      expect(fort(dualState('guardian', 'fighter', 9, carry(WOL, 1)))).toBe('master');
    });
    it('control: the single-class fighter with the same patched archetype stays expert', () => {
      expect(fort({ ...dualState('fighter', 'guardian', 9, carry(WOL, 0)), variantRules: {}, classId2: null, subclassId2: null })).toBe('expert');
    });
  });

  /*
   * The sweep: for EVERY shipped class archetype that removes a feature, on its own class, paired with a
   * class that does and one that does not grant that feature, in both orders — the sheet owns a
   * suppressed feature exactly when the Feats tab lists it. This is the disagreement the ruling closed.
   */
  it('every suppressing archetype, every pairing: the Feats tab lists a suppressed feature exactly when the sheet owns it', () => {
    const carriers = Object.entries(db.feats).filter(([, f]) => f.classArchetype?.suppressFeatures?.length);
    expect(carriers.length).toBeGreaterThanOrEqual(6);
    const partners = ['fighter', 'guardian', 'champion', 'wizard', 'witch', 'sorcerer', 'cleric', 'druid', 'rogue', 'investigator'];
    let checked = 0;
    let keptByOther = 0;
    for (const [carrier, f] of carriers) {
      const ca = f.classArchetype!;
      for (const own of Array.isArray(ca.classId) ? ca.classId : [ca.classId]) {
        for (const other of partners.filter((p) => p !== own && db.classes[p])) {
          for (const [ch, ownSlot] of [
            [dual(own, other, 13, carry(carrier, 0)), 0],
            [dual(other, own, 13, carry(carrier, 1)), 1],
          ] as const) {
            expect(ch.classArchetype?.classId, `${carrier} on ${own} (slot ${ownSlot})`).toBe(own);
            const owned = ownedFeatureIds(ch, db);
            for (const id of ca.suppressFeatures ?? []) {
              const listedOther = featsTabLists(ch, other, id);
              expect(featsTabLists(ch, own, id), `${own}+${other}: ${id} under the archetype's class`).toBe(false);
              expect(owned.has(id), `${own}+${other} (${carrier}): ${id} owned ⇔ listed under ${other}`).toBe(listedOther);
              checked++;
              if (listedOther) keptByOther++;
            }
          }
        }
      }
    }
    // Real coverage: plenty of checks, and the ten where the other class keeps the feature (Shield Block
    // under a Guardian, Champion or Druid; Defensive Robes under a Witch or Sorcerer; both orders).
    expect(checked).toBeGreaterThan(100);
    expect(keptByOther).toBeGreaterThanOrEqual(10);
  });
});
