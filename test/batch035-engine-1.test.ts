import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { buildCharacter, emptyBuild, checkPrerequisites, applyEditionFilter } from '../src/rules/build';
import { deriveStrikes } from '../src/rules/derive';
import type { Character, ContentDatabase } from '../src/rules/types';

/*
 * Batch 035, engine chunk 1. Every assertion is read off a BUILT character (or off the real
 * prerequisite checker / edition filter), never off a data field — a field with no reader is exactly
 * the defect these findings are about.
 */
const c = content();
const anc = Object.keys(c.ancestries)[0];
const bg = Object.keys(c.backgrounds)[0];

/** A raging barbarian wielding a GREATCLUB — non-agile, so the rider text carries the UNHALVED value
 *  (*"This additional damage is halved if your weapon or unarmed attack is agile"*). */
function ragingBarb(level: number, subclassId: string, answer?: string): Character {
  const ch = buildCharacter(
    {
      ...emptyBuild(),
      name: 't',
      level,
      classId: 'barbarian',
      ancestryId: anc,
      backgroundId: bg,
      keyAbility: 'str',
      subclassId,
      // The instinct's own pick is stored under the feature key; the `:0` twin is how a fanned-out
      // answer is stored, and both are written so the test does not depend on which one the build kept.
      featChoices: answer ? { [`feature:${subclassId}`]: answer, [`feature:${subclassId}:0`]: answer } : {},
      inventory: [{ instanceId: 'w1', itemId: 'greatclub', quantity: 1, equipped: true }],
    },
    c,
  );
  return { ...ch, classResources: { ...ch.classResources, rage: 1 } };
}

/** The Rage rider printed on that greatclub Strike. */
function rageRider(ch: Character) {
  const w = deriveStrikes(ch, c).find((s) => /greatclub/i.test(s.name));
  return w?.conditionalDamage?.find((r) => r.note.includes('raging')) ?? null;
}

describe('batch 035 — dragon-instinct: Draconic Rage', () => {
  /* *"change its damage type to match that of your instinct's dragon breath"* — a Cinder dragon
   * breathes fire, so every Strike of a raging Cinder barbarian reads fire.
   * batch 035: dragon-instinct#breath-damage-type */
  it('a Cinder-dragon barbarian (dragon-instinct) rages for the dragon\'s FIRE, not the "energy" placeholder', () => {
    const r = rageRider(ragingBarb(5, 'dragon-instinct', 'cinder'));
    expect(r).toBeTruthy();
    expect(r!.text).toContain('4 fire');
    expect(r!.text).not.toContain('energy');
  });

  /* A second dragon, because a map that answers every question with one type is not a lookup: Rime
   * breathes cold (its Draconic Resistance pair is [piercing, cold]).
   * batch 035: dragon-instinct#breath-damage-type */
  it('a Rime-dragon barbarian (dragon-instinct) rages for cold', () => {
    expect(rageRider(ragingBarb(5, 'dragon-instinct', 'rime'))!.text).toContain('4 cold');
  });

  /* An UNANSWERED dragon pick claims no type it was never given: 'energy' stays the fallback, exactly
   * as an unanswered elemental instinct does.
   * batch 035: dragon-instinct#breath-damage-type */
  it('an unanswered dragon-instinct barbarian keeps the "energy" placeholder', () => {
    expect(rageRider(ragingBarb(5, 'dragon-instinct'))!.text).toContain('energy');
  });

  /* *"When you rage, you CAN increase the additional damage from Rage from 2 to 4 and change its
   * damage type"* — the plain Rage branch (2, the weapon's own bludgeoning) is a choice the player
   * makes at the table every Rage, and printing only the draconic branch hid it.
   * batch 035: dragon-instinct#optional-rage */
  it('dragon-instinct shows BOTH branches: the draconic one and plain Rage (choose each Rage)', () => {
    const r = rageRider(ragingBarb(5, 'dragon-instinct', 'cinder'))!;
    expect(r.text).toBe('4 fire or 2 bludgeoning (choose each Rage)');
  });

  /* *"When you use draconic rage, you increase the additional damage from Rage from 4 to 8"* — the
   * step-ups belong to the draconic branch only; the alternative stays Rage's own 2.
   * batch 035: dragon-instinct#optional-rage */
  it('dragon-instinct steps the draconic branch up at 7 and 15, leaving the plain branch at 2', () => {
    expect(rageRider(ragingBarb(7, 'dragon-instinct', 'cinder'))!.text).toBe('8 fire or 2 bludgeoning (choose each Rage)');
    expect(rageRider(ragingBarb(15, 'dragon-instinct', 'cinder'))!.text).toBe('16 fire or 2 bludgeoning (choose each Rage)');
  });
});

/*
 * Verifier addition (batch 035, engine-1). The breath type is read off the chosen option's own
 * Draconic Resistance list, and THAT LIST IS BEING RE-EMITTED IN THIS SAME BATCH: the
 * dragon-instinct#duplicate-piercing row collapses Crystal's and Forest's [piercing, piercing] to a
 * single [piercing], because *"you resist piercing damage and the damage type of your instinct's
 * dragon breath"* names one type twice for a dragon that breathes piercing. Both shapes are exercised
 * here, so the lookup cannot go quiet the moment that row lands.
 */
function ragingBarbOn(db: ContentDatabase, level: number, subclassId: string, answer?: string): Character {
  const ch = buildCharacter(
    {
      ...emptyBuild(),
      name: 't',
      level,
      classId: 'barbarian',
      ancestryId: anc,
      backgroundId: bg,
      keyAbility: 'str',
      subclassId,
      featChoices: answer ? { [`feature:${subclassId}`]: answer, [`feature:${subclassId}:0`]: answer } : {},
      inventory: [{ instanceId: 'w1', itemId: 'greatclub', quantity: 1, equipped: true }],
    },
    db,
  );
  const raging = { ...ch, classResources: { ...ch.classResources, rage: 1 } };
  return raging;
}
function rageRiderOn(db: ContentDatabase, ch: Character) {
  const w = deriveStrikes(ch, db).find((s) => /greatclub/i.test(s.name));
  return w?.conditionalDamage?.find((r) => r.note.includes('raging')) ?? null;
}

describe('batch 035 — dragon-instinct: a piercing-breathing dragon (Crystal), in both shapes of its resistance list', () => {
  /* Crystal breathes piercing, so its Draconic Resistance list names one type — the same one — twice
   * as shipped today.
   * batch 035: dragon-instinct#breath-damage-type */
  it('dragon-instinct + Crystal reads the breath (piercing) on the shipped resistance pair', () => {
    expect(rageRiderOn(c, ragingBarbOn(c, 5, 'dragon-instinct', 'crystal'))!.text).toBe(
      '4 piercing or 2 bludgeoning (choose each Rage)',
    );
  });

  /* …and on the COLLAPSED list the same batch produces. Patched in memory, so this asserts the same
   * thing before and after that row lands rather than flipping with it.
   * batch 035: dragon-instinct#breath-damage-type */
  it('dragon-instinct + Crystal still reads piercing when the duplicate resistance entry is gone', () => {
    const raw = c.classFeatures['dragon-instinct'];
    const collapsed = {
      ...c,
      classFeatures: {
        ...c.classFeatures,
        'dragon-instinct': {
          ...raw,
          choice: {
            ...raw.choice!,
            options: (raw.choice!.options ?? []).map((o) =>
              o.value === 'crystal' || o.value === 'forest'
                ? {
                    ...o,
                    grant: {
                      ...o.grant,
                      whileActive: [{ ...o.grant!.whileActive![0], resistances: [o.grant!.whileActive![0].resistances![0]] }],
                    },
                  }
                : o,
            ),
          },
        },
      },
    } as ContentDatabase;
    const opt = collapsed.classFeatures['dragon-instinct'].choice!.options!.find((o) => o.value === 'crystal')!;
    expect(opt.grant!.whileActive![0].resistances).toHaveLength(1); // the shape this proves against
    expect(rageRiderOn(collapsed, ragingBarbOn(collapsed, 5, 'dragon-instinct', 'crystal'))!.text).toBe(
      '4 piercing or 2 bludgeoning (choose each Rage)',
    );
  });
});

describe('batch 035 — cultivation-order counts as a member of the leaf order', () => {
  /* druidic-order-12: *"The cultivation order is a variant of the leaf order. If you have the
   * cultivation order, you count as a member of the leaf order, and you qualify for leaf order
   * feats."* (druidic-order-13 prints the same clause for spore.)
   *
   * The ten records printing prerequisite "leaf order" fall through UNENFORCED today, because
   * "leaf order" is not a feat id — so the membership is proved on a content copy where it IS one,
   * which is the only state in which the has-set can be observed at all. Nothing here depends on a
   * data row: the copy is patched in memory and the shipped content is untouched.
   * batch 035: cultivation-order#leaf-membership */
  it('a cultivation-order (and spore-order) druid qualifies for a leaf order feat; a stone-order druid does not', () => {
    const leafFeat = c.feats['leshy-familiar'];
    expect(leafFeat.prerequisites).toContain('leaf order');
    // The prerequisite lane enforces a has-feat line only when it resolves to a known feat.
    const db = { ...c, feats: { ...c.feats, 'leaf-order': { ...leafFeat, id: 'leaf-order', name: 'Leaf Order', prerequisites: [] } } } as ContentDatabase;
    const met = (subclassId: string) => checkPrerequisites(leafFeat, build('druid', 3, { subclassId }), db).met;
    expect(met('cultivation-order')).toBe(true);
    expect(met('spore-order')).toBe(true);
    expect(met('leaf-order')).toBe(true);
    expect(met('stone-order')).toBe(false);
  });
});

describe('batch 035 — fury-instinct is Player Core 2 content, not legacy', () => {
  /* instinct-10 (Player Core 2 p.75) is the page our record's every mechanic comes from — Unstoppable
   * Frenzy's 3/7/13 and the bonus 1st-level barbarian feat — while the record cites instinct-3 (Core
   * Rulebook p.87, which prints 6/12) and carries edition "legacy". With the tag as shipped a
   * Hide-legacy barbarian loses the instinct from the picker; the row that repoints it is the driver's
   * (DATA STILL NEEDED), so the state it produces is patched into a content copy here.
   * batch 035: fury-instinct */
  it('with the corrected edition, fury-instinct survives Hide legacy data — and still builds the PC2 3/7/13 rage', () => {
    const patched = {
      ...c,
      classFeatures: { ...c.classFeatures, 'fury-instinct': { ...c.classFeatures['fury-instinct'], aonId: 'instinct-10', edition: 'remaster' } },
    } as ContentDatabase;
    const filtered = applyEditionFilter(patched, { hideLegacy: true }, new Set<string>());
    expect(filtered.classFeatures['fury-instinct']).toBeTruthy();
    // The mechanics that make instinct-10 the right page, read off a built character.
    expect(rageRider(ragingBarb(5, 'fury-instinct'))!.text).toContain('3');
    expect(rageRider(ragingBarb(15, 'fury-instinct'))!.text).toContain('13');
  });
});
