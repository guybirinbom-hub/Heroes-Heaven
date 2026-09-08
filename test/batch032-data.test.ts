import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { deriveBulk, deriveDefenses, narrowChoiceOptions } from '../src/rules/derive';
import type { Character, FeatChoiceDef, ModeDef } from '../src/rules/types';

/**
 * Batch-032, WG-comparison lane — the DATA-ROWS family.
 *
 * Every assertion reads `public/core.json` (plus `public/core-descriptions.json`) through
 * `content()` and pins the field the driver's backfill row authors, then — where a reader exists —
 * runs that field through the real derive on a BUILT character. Nothing here compares a patched copy
 * against the shipped one, so no assertion flips direction when the rows land: each fails today for
 * exactly one reason (the field is absent) and passes once the row is applied.
 */
const db = () => content();
const feat = (id: string) => db().feats[id] as Record<string, unknown> | undefined;
const item = (id: string) => db().items[id] as Record<string, unknown> | undefined;

/** A built character carrying `featId`, for the readers that walk `c.feats`. */
const withFeat = (classId: string, level: number, featId: string): Character =>
  ({ ...build(classId, level), feats: [{ featId, level, category: 'class' as const }] }) as Character;

describe('safeguard-soul cannot be made undead', () => {
  // batch 032: safeguard-soul#undead
  it('carries the printed immunity and shows it in the IWR list', () => {
    // "You can't be transformed into an undead by any means." (AoN feat-3472) — the record held only
    // actionCost/archetype metadata, so the categorical immunity reached no surface at all.
    const defs = deriveDefenses(withFeat('champion', 8, 'safeguard-soul'), db());
    expect(Array.isArray(defs.immunities)).toBe(true); // the harness half, so the assertion below can only fail on the field
    expect(feat('safeguard-soul')?.immunities).toEqual(['being transformed into an undead']);
    expect(defs.immunities).toContain('being transformed into an undead');
  });
});

describe('heal-mount changes what Lay on Hands restores', () => {
  // batch 032: heal-mount
  it('hangs the 10-per-rank clause on the spell the player reads', () => {
    // "When you cast lay on hands on your mount, instead of the normal amount, the spell restores 10
    // Hit Points, plus 10 for each heightened rank." (AoN feat-5906) — we carried nothing at all.
    const ch = build('champion', 8, { featPicks: { '8:class': 'heal-mount' } });
    expect(ch.feats.some((f) => f.featId === 'heal-mount')).toBe(true); // the harness half
    const notes = feat('heal-mount')?.spellNotes as { spellId: string; note: string }[] | undefined;
    expect(notes?.map((n) => n.spellId)).toEqual(['lay-on-hands']);
    expect(notes?.[0].note).toMatch(/10 Hit Points, plus 10 for each heightened rank/);
    expect(ch.spellNotes?.['lay-on-hands']?.some((n) => /10 for each heightened rank/.test(n.note))).toBe(true);
  });
});

describe('magic-finder gives a non-caster an Intelligence spellcasting statistic', () => {
  // batch 032: magic-finder#spellcasting-statistic
  it('keys the innate entry off Intelligence instead of the Charisma fallback', () => {
    // "Otherwise, they're arcane spells, you use Intelligence as your spellcasting ability, and you
    // become trained in spell attack rolls and spell DCs for arcane spells." (AoN feat-2234)
    // A fighter: no class caster, so build.ts's `caster?.keyAbility ?? profile?.keyAbility ?? 'cha'`
    // has only this grant to read.
    const ch = build('fighter', 8, { featPicks: { '8:class': 'magic-finder' } });
    const innate = ch.spellcasting.find((s) => s.type === 'innate');
    expect(innate?.repertoire?.[3]).toContain('locate'); // the harness half: the feat's spells are in the entry
    expect(feat('magic-finder')?.spellcastingGrant).toEqual({ tradition: 'arcane', keyAbility: 'int', proficiency: 'trained' });
    expect(innate?.keyAbility).toBe('int');
  });
});

describe('basic-beast-gunner-spellcasting says what it grants', () => {
  // batch 032: basic-beast-gunner-spellcasting#dropped-clause
  it('names the basic spellcasting benefits the stripped link label used to carry', () => {
    // "You gain the [basic spellcasting benefits](/Rules.aspx?ID=170)." (AoN feat-3230) — the importer
    // stripped the link and its label, leaving the shipped sentence "You gain the ."
    const d = feat('basic-beast-gunner-spellcasting')?.description as string | undefined;
    expect(d).toContain('You gain the basic spellcasting benefits.');
    expect(d).not.toMatch(/\bthe \./);
  });
});

describe('second-blessing must differ from the level-3 blessing', () => {
  // batch 032: second-blessing
  it('greys the blessing the champion already owns', () => {
    // "Choose a second blessing of the devoted (different from your first one)" (AoN feat-5907) — with
    // no `disableIfOwned` the picker offered the level-3 pick again.
    const ch = build('champion', 8, { extraChoices: { blessing: ['blessed-swiftness'] } });
    expect(ch.classChoices?.some((cc) => cc.id === 'blessed-swiftness')).toBe(true); // the harness half
    const choice = feat('second-blessing')?.choice as FeatChoiceDef | undefined;
    expect(choice?.disableIfOwned).toBe(true);
    const opts = narrowChoiceOptions('second-blessing', choice!, choice!.options!, ch, db());
    expect(opts.find((o) => o.value === 'blessed-swiftness')?.disabled).toMatch(/Already taken/);
    expect(opts.filter((o) => !o.disabled).map((o) => o.value)).toEqual(['blessed-armament', 'blessed-shield']);
  });
});

describe('lifting-leather raises the wearer Bulk limits', () => {
  // batch 032: lifting-leather
  it('moves the encumbered threshold by 2 while it is worn', () => {
    // "While wearing this armor, you can carry 2 more Bulk than normal before becoming encumbered and
    // up to a maximum of 4 more Bulk." (AoN equipment-3816) — the record had no passiveEffects, so
    // deriveBulk's item lane (which reads passiveEffects.bulkLimitBonus) moved neither threshold.
    const base = build('fighter', 8);
    const wearing = {
      ...base,
      inventory: [{ instanceId: 'i1', itemId: 'lifting-leather', quantity: 1, worn: true, invested: true }],
    } as Character;
    expect(deriveBulk(base, db()).encumberedAt).toBeGreaterThan(0); // the harness half
    const pe = item('lifting-leather')?.passiveEffects as { bulkLimitBonus?: number; bulkMaxBonus?: number } | undefined;
    expect(pe?.bulkLimitBonus).toBe(2);
    // The maximum-only half: authored here because one field is one row, read by the engine family's
    // item-lane `bulkMaxBonus` (see the report's CROSS-FILE GAPS).
    expect(pe?.bulkMaxBonus).toBe(2);
    expect(deriveBulk(wearing, db()).encumberedAt).toBe(deriveBulk(base, db()).encumberedAt + 2);
    /* …and the OTHER printed threshold — *"and up to a maximum of 4 more Bulk"*. Left unasserted while
     * ItemPassiveEffects had no `bulkMaxBonus` reader; the engine family's declaration (types.ts) and
     * deriveBulk's item loop (`itemMaxBonus`) have landed, so the printed 2/4 split is now pinned end
     * to end rather than half of it standing as inert data. */
    // batch 032: lifting-leather#max
    expect(deriveBulk(wearing, db()).max).toBe(deriveBulk(base, db()).max + 4);
  });
});

describe('crown-of-the-fire-eater has an activated mode', () => {
  // batch 032: crown-of-the-fire-eater#activation-effect
  it('raises the fire resistance from 5 to 15 while it is on', () => {
    // "Increase your fire resistance from the crown from 5 to 15. Just after taking any remaining fire
    // damage, you regain a number of Hit Points equal to 15 or the fire damage dealt…" (AoN
    // equipment-1435) — we carried the 1/day counter and the standing fire 5 only.
    const base = build('fighter', 8);
    const wearing = {
      ...base,
      inventory: [{ instanceId: 'i1', itemId: 'crown-of-the-fire-eater', quantity: 1, worn: true, invested: true }],
    } as Character;
    // The harness half, and the standing half of the printed sentence: the crown alone is fire 5.
    expect(deriveDefenses(wearing, db()).resistances.find((r) => r.type === 'fire')?.value).toBe(5);
    const mode = db().modes?.['item-crown-of-the-fire-eater'] as ModeDef | undefined;
    expect(mode?.fromItemId).toBe('crown-of-the-fire-eater');
    expect(mode?.resistances).toEqual([{ type: 'fire', value: 15 }]);
    expect(mode?.note).toMatch(/regain Hit Points equal to 15 or the fire damage dealt/);
    // Resistances do not stack: the mode's 15 supersedes the crown's standing 5, exactly as "from 5
    // to 15" says, rather than adding to it.
    const activated = { ...wearing, activeModes: [mode!] } as Character;
    expect(deriveDefenses(activated, db()).resistances.find((r) => r.type === 'fire')?.value).toBe(15);
  });
});
