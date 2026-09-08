import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import {
  buildCharacter,
  emptyBuild,
  foldArchSpellSlotBonuses,
  skillSlotOptions,
  type BuildState,
} from '../src/rules/build';
import { activeCasterArchetype, archetypeEntryIds, archetypeSlots } from '../src/rules/casterArchetypes';
import { deriveBlastStrikes, deriveBulk, deriveSpellcasting, deriveStrike } from '../src/rules/derive';
import { recordMarkersFor } from '../src/rules/explain';
import type { Character, ContentDatabase } from '../src/rules/types';

/*
 * Batch 032, WG-comparison lane — the ENGINE half.
 *
 * Several of these findings need a data row the driver authors from work/.b032-rows-engine.json. Those
 * tests build against a content copy with the field PATCHED IN MEMORY, never against a
 * patched-vs-shipped delta: the assertion has to keep meaning the same thing once the row lands.
 */

/** A shallow content clone with the named buckets copied, so a patch cannot leak into the cache. */
function patched(mut: (db: ContentDatabase) => void): ContentDatabase {
  const db = content();
  const clone = {
    ...db,
    feats: { ...db.feats },
    items: { ...db.items },
  } as ContentDatabase;
  mut(clone);
  return clone;
}

/** `build()` from _content.ts, against a patched database. */
function buildWith(db: ContentDatabase, classId: string, level: number, over: Partial<BuildState> = {}): Character {
  const cls = db.classes[classId];
  return buildCharacter(
    {
      ...emptyBuild(),
      name: 't',
      level,
      classId,
      ancestryId: Object.keys(db.ancestries)[0],
      backgroundId: Object.keys(db.backgrounds)[0],
      keyAbility: (cls && cls.keyAbility.length === 1 ? cls.keyAbility[0] : null) as BuildState['keyAbility'],
      subclassId: (db.classes[classId]?.subclass?.options[0]?.id as string) ?? null,
      ...over,
    },
    db,
  );
}

/** The per-rank pick cap the BUILDER computes for an archetype caster — the same two steps
 *  Builder.tsx's `archExtraKnownAt` runs (archetypeSlots, then the shared fold). */
function builderPickCap(featIds: string[], level: number): Record<number, number> {
  const arch = activeCasterArchetype(featIds)!;
  const slots = archetypeSlots(level, arch);
  const extra: Record<number, number> = { ...(arch.config.extraKnown ?? {}) };
  foldArchSpellSlotBonuses(slots, extra, featIds, archetypeEntryIds(arch), content());
  for (const [r, n] of Object.entries(extra)) if ((slots[Number(r)] ?? 0) > 0) slots[Number(r)] += n;
  return slots;
}

describe('batch 032 — archetype spell-slot bonuses reach the builder pick cap', () => {
  // batch 032: occult-breadth
  it('occult-breadth: the bard-archetype rank-1 repertoire AND the builder pick cap are both 2', () => {
    const picks = {
      '2:class:0': 'bard-dedication',
      '4:class:1': 'basic-bard-spellcasting',
      '8:class:2': 'occult-breadth',
    };
    const ch = build('fighter', 8, {
      keyAbility: 'str',
      featPicks: picks,
      cantrips: ['c1'],
      spells: { 1: ['s1', 's2', 's3'] },
    });
    const entry = ch.spellcasting.find((e) => e.id === 'bard-dedication-casting');
    // "Increase the number of spells in your repertoire and the number of spell slots you gain from
    // bard archetype feats by 1 for each spell rank other than your two highest bard spell slots."
    expect(entry?.slots?.[1]?.max).toBe(2);
    expect(entry?.repertoire?.[1]).toEqual(['s1', 's2']);
    // …and the builder must offer exactly that many picks, which is the finding.
    expect(builderPickCap(Object.values(picks), 8)[1]).toBe(2);
  });

  // batch 032: occult-breadth
  it('occult-breadth: without the feat both the bard-dedication-casting repertoire and the cap stay at 1', () => {
    const picks = { '2:class:0': 'bard-dedication', '4:class:1': 'basic-bard-spellcasting' };
    const ch = build('fighter', 8, {
      keyAbility: 'str',
      featPicks: picks,
      cantrips: ['c1'],
      spells: { 1: ['s1', 's2', 's3'] },
    });
    const entry = ch.spellcasting.find((e) => e.id === 'bard-dedication-casting');
    expect(entry?.repertoire?.[1]).toEqual(['s1']);
    expect(builderPickCap(Object.values(picks), 8)[1]).toBe(1);
  });

  // batch 032: prolific-prophet-spellcasting
  it('prolific-prophet-spellcasting: the prophet-of-kalistrade pool and the builder cap move together', () => {
    const picks = {
      '2:class:0': 'prophet-of-kalistrade-dedication',
      '4:class:1': 'basic-prophet-spellcasting',
      '8:class:2': 'prolific-prophet-spellcasting',
    };
    const ch = build('fighter', 8, {
      keyAbility: 'str',
      featPicks: picks,
      cantrips: ['c1'],
      spells: { 1: ['s1', 's2', 's3'] },
    });
    const entry = ch.spellcasting.find((e) => e.id === 'prophet-of-kalistrade-dedication-casting');
    const rank1 = entry?.slots?.[1]?.max ?? 0;
    expect(rank1).toBeGreaterThan(1);
    expect(entry?.repertoire?.[1]?.length).toBe(rank1);
    expect(builderPickCap(Object.values(picks), 8)[1]).toBe(rank1);
  });
});

describe('batch 032 — magical-knowledge asks for two DIFFERENT skills', () => {
  // batch 032: magical-knowledge#distinct-skills
  it('magical-knowledge: an unanswered pair grants master in one skill and expert in ANOTHER', () => {
    const ch = build('fighter', 8, { keyAbility: 'str', featPicks: { '8:class:0': 'magical-knowledge' } });
    // "Increase your proficiency rank in one of Arcana, Nature, Occultism, or Religion from expert to
    // master AND IN ANOTHER from trained to expert." Both slots used to default to opts[0] = Arcana.
    const granted = (['arcana', 'nature', 'occultism', 'religion'] as const).filter(
      (s) => (ch.proficiencies.skills[s] ?? 'untrained') !== 'untrained',
    );
    expect(granted.length).toBeGreaterThanOrEqual(2);
  });

  // batch 032: magical-knowledge#distinct-skills
  it("magical-knowledge: the second slot's options drop the skill the first slot took", () => {
    const db = content();
    const state = { ...emptyBuild(), featPicks: { '8:class:0': 'magical-knowledge' }, featSkillChoices: { 'magical-knowledge:0': 'religion' } } as BuildState;
    const slot = { options: ['arcana', 'nature', 'occultism', 'religion'] } as const;
    const opts = skillSlotOptions({ options: [...slot.options] }, state, db, { featId: 'magical-knowledge', index: 1 });
    expect(opts).not.toContain('religion');
    expect(opts).toContain('arcana');
    // …and the FIRST slot keeps all four: the exclusion only ever looks backwards.
    expect(skillSlotOptions({ options: [...slot.options] }, state, db, { featId: 'magical-knowledge', index: 0 })).toHaveLength(4);
  });

  /* VERIFIER ADDITION (batch 032, engine): the report measured "exactly two records carry more than
   * one skillChoices slot" and named only magical-knowledge as changing. Re-measured over FEAT_GRANTS:
   * ELEVEN records carry more than one slot, and TWO of them have byte-identical CLOSED lists, so the
   * distinct-sibling narrowing changes golden-league-xun-dedication too. Print backs it — pinned here
   * so the second changed record is not an unwitnessed side effect. */
  // batch 032 premise: feat-2734 "expert proficiency in two of the following skills"
  it('golden-league-xun-dedication: the pair of identical slots also resolves to TWO skills', () => {
    const ch = build('fighter', 8, { keyAbility: 'str', featPicks: { '8:class:0': 'golden-league-xun-dedication' } });
    const expert = (['athletics', 'deception', 'intimidation', 'stealth'] as const).filter(
      (s) => ch.proficiencies.skills[s] === 'expert' || ch.proficiencies.skills[s] === 'master',
    );
    expect(expert.length).toBeGreaterThanOrEqual(2);
  });
});

describe('batch 032 — magic-finder casts at the caster’s own tradition', () => {
  const withFlag = () =>
    patched((db) => {
      const f = db.feats['magic-finder'];
      db.feats['magic-finder'] = {
        ...f,
        innateSpells: (f.innateSpells ?? []).map((g) => ({ ...g, traditionFromCasting: true })),
      };
    });

  // batch 032: magic-finder#tradition
  it('magic-finder: a divine cleric reads the granted spells as divine, not arcane', () => {
    const db = withFlag();
    const ch = buildWith(db, 'cleric', 4, { featPicks: { '4:class:0': 'magic-finder' } });
    const innate = ch.spellcasting.find((e) => e.type === 'innate');
    // "If you could already cast spells, these spells are of the same tradition."
    expect(innate?.spellTraditions?.['detect-magic']).toBe('divine');
  });

  // batch 032: magic-finder#tradition
  it('magic-finder: a fighter (no casting) keeps the printed arcane fallback', () => {
    const db = withFlag();
    const ch = buildWith(db, 'fighter', 4, { keyAbility: 'str', featPicks: { '4:class:0': 'magic-finder' } });
    const innate = ch.spellcasting.find((e) => e.type === 'innate');
    // "Otherwise, they're arcane spells."
    expect(innate?.spellTraditions?.['detect-magic']).toBe('arcane');
  });
});

describe('batch 032 — an item’s printed tradition and printed DC beat the wielder’s', () => {
  const wearing = (itemId: string) => ({ inventory: [{ itemId, quantity: 1, worn: true, invested: true, equipped: true }] });

  // batch 032: canopy-bulwark#spell-tradition
  it('canopy-bulwark: the item entry is PRIMAL once the armour names its tradition', () => {
    const db = patched((d) => {
      d.items['canopy-bulwark'] = { ...d.items['canopy-bulwark'], heldSpellTradition: 'primal' };
    });
    const ch = buildWith(db, 'fighter', 8, { keyAbility: 'str', ...wearing('canopy-bulwark') });
    const entry = ch.spellcasting.find((e) => e.type === 'items' && e.name === 'Canopy Bulwark');
    expect(entry?.tradition).toBe('primal');
  });

  /* CLOSER, batch 032: the negative twin built against SHIPPED content, which is a patched-vs-shipped
   * delta — it passed while the row was unapplied and flipped the moment --stage apply wrote
   * items/canopy-bulwark.heldSpellTradition. Stripped in memory instead, so it keeps asserting the same
   * thing (no field ⇒ the old majority vote) whatever the overlay holds. */
  // batch 032: canopy-bulwark#spell-tradition
  it('canopy-bulwark: WITHOUT the field the tradition vote still returns arcane (the defect this fixes)', () => {
    const db = patched((d) => {
      const { heldSpellTradition: _drop, ...rest } = d.items['canopy-bulwark'] as { heldSpellTradition?: string };
      d.items['canopy-bulwark'] = rest as ContentDatabase['items'][string];
    });
    const ch = buildWith(db, 'fighter', 8, { keyAbility: 'str', ...wearing('canopy-bulwark') });
    const entry = ch.spellcasting.find((e) => e.type === 'items' && e.name === 'Canopy Bulwark');
    expect(entry?.tradition).toBe('arcane');
  });

  // batch 032: sigil-of-the-first-clan#spell-dc
  it('sigil-of-the-first-clan: the entry casts Command at the printed DC 24', () => {
    const db = patched((d) => {
      d.items['sigil-of-the-first-clan'] = { ...d.items['sigil-of-the-first-clan'], heldSpellDc: 24 };
    });
    const ch = buildWith(db, 'fighter', 8, { keyAbility: 'str', ...wearing('sigil-of-the-first-clan') });
    const entry = ch.spellcasting.find((e) => e.type === 'items' && e.name === 'Sigil of the First Clan')!;
    // "You cast 1st-level command with a DC of 24."
    expect(entry.fixedDc).toBe(24);
    expect(deriveSpellcasting(ch, entry).dc).toBe(24);
  });

  /* CLOSER, batch 032: same repair as the canopy-bulwark twin above — this negative was a
   * patched-vs-shipped delta and flipped when --stage apply wrote items/sigil-of-the-first-clan.heldSpellDc.
   * The field is stripped in memory so "no printed DC ⇒ the wielder's statistic" stays the claim. */
  // batch 032: sigil-of-the-first-clan#spell-dc
  it('sigil-of-the-first-clan: an entry with no printed DC still uses the wielder’s statistic', () => {
    const db = patched((d) => {
      const { heldSpellDc: _drop, ...rest } = d.items['sigil-of-the-first-clan'] as { heldSpellDc?: number };
      d.items['sigil-of-the-first-clan'] = rest as ContentDatabase['items'][string];
    });
    const ch = buildWith(db, 'fighter', 8, { keyAbility: 'str', ...wearing('sigil-of-the-first-clan') });
    const entry = ch.spellcasting.find((e) => e.type === 'items' && e.name === 'Sigil of the First Clan')!;
    expect(entry.fixedDc).toBeUndefined();
    expect(deriveSpellcasting(ch, entry).dc).not.toBe(24);
  });
});

describe('batch 032 — lifting-leather moves the two Bulk thresholds by DIFFERENT amounts', () => {
  // batch 032: lifting-leather#max
  it('lifting-leather: +2 encumbered and +4 maximum', () => {
    const db = patched((d) => {
      d.items['lifting-leather'] = {
        ...d.items['lifting-leather'],
        passiveEffects: { ...(d.items['lifting-leather'].passiveEffects ?? {}), bulkLimitBonus: 2, bulkMaxBonus: 2 },
      };
    });
    const bare = buildWith(db, 'fighter', 8, { keyAbility: 'str' });
    const worn = buildWith(db, 'fighter', 8, {
      keyAbility: 'str',
      inventory: [{ itemId: 'lifting-leather', quantity: 1, worn: true, invested: true, equipped: true }],
    });
    const b = deriveBulk(bare, db);
    const w = deriveBulk(worn, db);
    // "you can carry 2 more Bulk than normal before becoming encumbered and up to a maximum of 4 more Bulk"
    expect(w.encumberedAt - b.encumberedAt).toBe(2);
    expect(w.max - b.max).toBe(4);
  });
});

describe('batch 032 — canopy-bulwark carries its assisting rune’s Bulk grant', () => {
  // batch 032: canopy-bulwark#assisting-rune
  it('canopy-bulwark: a +1 ASSISTING leaf weave raises both Bulk thresholds by 1', () => {
    // `builtInRunes.property` has no reader anywhere (0 of 374 items carry one), so the assisting
    // rune reaches the wearer through the item's own passiveEffects, which derive.ts already reads.
    const db = patched((d) => {
      d.items['canopy-bulwark'] = { ...d.items['canopy-bulwark'], passiveEffects: { ...(d.items['canopy-bulwark'].passiveEffects ?? {}), bulkLimitBonus: 1 } };
    });
    const bare = buildWith(db, 'fighter', 8, { keyAbility: 'str' });
    const worn = buildWith(db, 'fighter', 8, {
      keyAbility: 'str',
      inventory: [{ itemId: 'canopy-bulwark', quantity: 1, worn: true, invested: true, equipped: true }],
    });
    expect(deriveBulk(worn, db).encumberedAt - deriveBulk(bare, db).encumberedAt).toBe(1);
    expect(deriveBulk(worn, db).max - deriveBulk(bare, db).max).toBe(1);
  });
});

describe('batch 032 — Elemental Blast for an ARCHETYPE kineticist', () => {
  const dedication = (extraPicks: Record<string, string> = {}): Partial<BuildState> => ({
    keyAbility: 'str',
    featPicks: { '2:class:0': 'kineticist-dedication', ...extraPicks },
    featChoices: { '2:class:0': 'fire-gate' },
  });

  // batch 032: improved-elemental-blast#no-archetype-blast
  it('kineticist-dedication: the Elemental Blast strike exists for a non-kineticist', () => {
    const ch = build('fighter', 8, dedication());
    expect(ch.kineticist?.elements).toEqual(['fire']);
    expect(ch.kineticist?.archetype).toBe(true);
    const blasts = deriveBlastStrikes(ch, content());
    expect(blasts.map((s) => s.name)).toContain('Elemental Blast (Fire)');
  });

  // batch 032: improved-elemental-blast#no-archetype-blast
  it('kineticist-dedication: the archetype blast does NOT take the class’s die-scaling table', () => {
    const ch = build('fighter', 17, dedication());
    // The +1 die at 5/9/13/17 belongs to the kineticist class; an archetype blast grows only through
    // Improved Elemental Blast.
    expect(deriveBlastStrikes(ch, content())[0]?.damage.startsWith('1d')).toBe(true);
    const classKin = build('kineticist', 17, { extraChoices: { element: ['fire-gate'] } });
    expect(classKin.kineticist?.archetype).toBeUndefined();
    expect(deriveBlastStrikes(classKin, content())[0]?.damage.startsWith('5d')).toBe(true);
  });

  // batch 032: improved-elemental-blast
  it('improved-elemental-blast: each taking adds one damage die to the Elemental Blast', () => {
    const db = patched((d) => {
      d.feats['improved-elemental-blast'] = { ...d.feats['improved-elemental-blast'], blastDiceBonus: 1 };
    });
    const once = buildWith(db, 'fighter', 14, dedication({ '10:class:1': 'improved-elemental-blast' }));
    // "The damage of your elemental blast increases by one die."
    expect(deriveBlastStrikes(once, db)[0]?.damage.startsWith('2d')).toBe(true);
    const twice = buildWith(
      db,
      'fighter',
      14,
      dedication({ '10:class:1': 'improved-elemental-blast', '14:class:2': 'improved-elemental-blast' }),
    );
    // "You can take Improved Elemental Blast a second time at 14th level to increase your Elemental
    // Blast to three damage die."
    expect(deriveBlastStrikes(twice, db)[0]?.damage.startsWith('3d')).toBe(true);
  });
});

describe('batch 032 — the mind weapon actually gains its Mental Forge traits', () => {
  const forge = (db: ContentDatabase) => {
    db.feats['mental-forge'] = {
      ...db.feats['mental-forge'],
      weaponTraits: { match: { items: ['mind-weapon'] }, addFromChoiceFlag: 'mentalForgeTraits' },
    };
    db.feats['malleable-mental-forge'] = {
      ...db.feats['malleable-mental-forge'],
      choice: { ...db.feats['malleable-mental-forge'].choice!, replacesFlag: 'mentalForgeTraits' },
    };
  };
  const picks = { '2:class:0': 'mind-smith-dedication', '4:class:1': 'mental-forge' };
  const answers = { '4:class:1#0': 'grapple', '4:class:1#1': 'trip' };
  const held = { itemId: 'mind-weapon', quantity: 1, equipped: true };

  // batch 032: malleable-mental-forge
  it('mental-forge: the two chosen traits reach the mind-weapon Strike', () => {
    const db = patched(forge);
    const ch = buildWith(db, 'fighter', 8, { keyAbility: 'str', featPicks: picks, featChoices: answers, inventory: [held] });
    const strike = deriveStrike(ch, db, ch.inventory.find((i) => i.itemId === 'mind-weapon')!)!;
    expect(strike.traits).toEqual(expect.arrayContaining(['grapple', 'trip']));
  });

  // batch 032: malleable-mental-forge
  it('malleable-mental-forge: today’s pair REPLACES the Mental Forge pair rather than joining it', () => {
    const db = patched(forge);
    const ch = buildWith(db, 'fighter', 8, {
      keyAbility: 'str',
      featPicks: { ...picks, '8:class:2': 'malleable-mental-forge' },
      featChoices: answers,
      inventory: [held],
    });
    // "…replacing the traits you chose from the Mental Forge feat."
    const today = { ...ch, dailyChoices: { 'malleable-mental-forge:mindWeaponTraits': 'shove,nonlethal' } } as Character;
    const strike = deriveStrike(today, db, today.inventory.find((i) => i.itemId === 'mind-weapon')!)!;
    expect(strike.traits).toEqual(expect.arrayContaining(['shove', 'nonlethal']));
    expect(strike.traits).not.toContain('grapple');
    expect(strike.traits).not.toContain('trip');
  });
});

describe('batch 032 — projectile-snatching marks Deflect Projectile', () => {
  // batch 032: projectile-snatching
  it('projectile-snatching: the return-Strike note reaches the Deflect Projectile feature row', () => {
    const note =
      'When you successfully deflect an attack with Deflect Projectile, you can immediately make a ranged Strike against the attacker with the deflected projectile as part of that same reaction; it is a thrown weapon with the triggering attack’s range increment and effect on a hit.';
    const db = patched((d) => {
      d.feats['projectile-snatching'] = {
        ...d.feats['projectile-snatching'],
        recordMarks: [
          { on: 'feature', id: 'deflect-projectile', note },
          { on: 'action', id: 'deflect-projectile', note },
        ],
      };
    });
    const ch = buildWith(db, 'monk', 8, { featPicks: { '8:class:0': 'projectile-snatching' } });
    // "…as part of that same reaction, you can then immediately make a ranged Strike against the attacker
    // using the projectile you deflected."
    expect(recordMarkersFor(ch, db, 'feature', 'deflect-projectile').map((m) => m.sourceId)).toContain('projectile-snatching');
  });
});
