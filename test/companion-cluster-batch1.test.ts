import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import type { BuildState, CompanionConfig } from '../src/rules/types';
import { deriveAnimalCompanion, deriveEidolon, deriveFamiliar, huntersEdgeName } from '../src/rules/companions';
import { companionModKeys, FEAT_COMPANION_GRANTS } from '../src/rules/companionGrants';
import { abilityModOf } from '../src/rules/derive';
import { markNote, markTooltip, nameOfRecord, recordMarkersFor } from '../src/rules/explain';
import { RECORD_MARKERS } from '../src/rules/situationalBonuses';
import { audit as auditCompanionLocks } from '../scripts/scan-companion-locks.mjs';

/*
 * Batch-001 cluster "companion-eidolon-familiar" — the owner's feat has an answer the companion never
 * receives. Three findings, all of which reached the companion's own block and none of which reached
 * it before: Advanced Weaponry's trait, Alchemical Familiar's Construct/Intelligence clause, and
 * Animal Companion (Ranger)'s Hunt Prey sentence.
 */
const db = content();

/* ============================================================ Alchemical Familiar (the free lock) */

const familiar = (over: Partial<CompanionConfig>, level = 4, cls = 'alchemist') =>
  deriveFamiliar({ id: 'f', kind: 'familiar', name: '', abilities: [], ...over } as CompanionConfig, build(cls, level, {}), db);

describe('a locked familiar ability is FREE only where the record prints that it is', () => {
  it('Alchemical Familiar: Construct, not Tough, and Intelligence drives three statistics', () => {
    const g = FEAT_COMPANION_GRANTS['alchemical-familiar'];
    // The printed waiver, guarding against the "Construct requires Tough" reflex re-adding it:
    // "…has the Construct familiar ability; this is permanent, DOESN'T REQUIRE the familiar to have
    // the Tough familiar ability, and doesn't count against your usual limit."
    expect(g.lockedAbilities).toEqual(['construct']);
    expect(g.lockedFree).toBe(true);
    expect(g.statAbility).toBe('int');
  });

  it('lockedFree is set on exactly the records that print it', () => {
    // Each of these four prints the clause; the other four grants with lockedAbilities print the
    // OPPOSITE ("counts against your limit … as normal"), and adding one here overpays the player.
    const free = Object.entries(FEAT_COMPANION_GRANTS).filter(([, g]) => g.lockedFree).map(([k]) => k).sort();
    expect(free).toEqual(['alchemical-familiar', 'elver-pet', 'friend-of-the-sea', 'spore-order']);
  });

  it('a free lock costs no ability slot and cannot be spent', () => {
    const b = familiar({ grantSlug: 'alchemical-familiar' });
    // 5 × level, NOT 7 × level: `hasTough` used to fire because 'tough' was a locked id here.
    expect(b.hp).toBe(20);
    expect(b.abilities.find((a) => a.id === 'construct')?.fromFeat).toBe('alchemical-familiar');
    expect(b.abilities.some((a) => a.id === 'tough')).toBe(false);
    expect(b.abilities.filter((a) => !a.fromFeat)).toHaveLength(0);
  });

  it('a locked ability that COUNTS is still one of the player’s picks', () => {
    // The refutation that mattered: Corgi Mount prints "the scent ability, WHICH COUNTS AGAINST your
    // limit for familiar and master abilities as normal". Treating every lock as free would let a
    // corgi owner take two more and end with three abilities where the rules give two.
    for (const slug of ['corgi-mount', 'draconic-familiar', 'psychopomp-familiar', 'enhanced-psychopomp-familiar', 'star-orb']) {
      const locked = FEAT_COMPANION_GRANTS[slug].lockedAbilities ?? [];
      expect(locked.length, slug).toBeGreaterThan(0);
      const b = familiar({ grantSlug: slug, abilities: locked });
      expect(b.abilities.filter((a) => !a.fromFeat).length, slug).toBe(locked.length);
    }
  });

  it('Star Orb’s always-present Innate Surge exists at all (it was missing entirely)', () => {
    expect(FEAT_COMPANION_GRANTS['star-orb'].lockedAbilities).toEqual(['innate-surge']);
    expect(FEAT_COMPANION_GRANTS['star-orb'].lockedFree).toBeUndefined();
  });

  it('Intelligence drives Perception, Acrobatics and Stealth — and the block says so', () => {
    const ch = build('alchemist', 4, {});
    const b = familiar({ grantSlug: 'alchemical-familiar' });
    const expected = abilityModOf(ch, 'int') + 4;
    expect(b.perception).toBe(expected);
    expect(b.skills?.map((s) => s.name)).toEqual(['Acrobatics', 'Stealth']);
    expect(b.skills?.map((s) => s.modifier)).toEqual([expected, expected]);
    expect(b.statNote).toContain('Intelligence modifier + your level');
    expect(b.statNote).toContain('HP equal to 5 × your level');
  });

  it('a plain familiar is untouched — no skills row, no statNote, master’s Perception', () => {
    const b = familiar({});
    expect(b.skills).toBeUndefined();
    expect(b.statNote).toBeUndefined();
    expect(b.hp).toBe(20);
  });

  it('a CHOSEN Tough still raises HP, and a granted one still does too', () => {
    expect(familiar({ abilities: ['tough'] }).hp).toBe(28);
    // Friend of the Sea's Tough is free AND real: it must still reach `has('tough')`.
    expect(familiar({ grantSlug: 'friend-of-the-sea' }).hp).toBe(28);
  });

  it('MIGRATION, honestly: a save made before this fix keeps its chosen Tough until the player drops it', () => {
    // No save-data migration ships with this change, so the assertion states what actually happens
    // rather than what a migration would make happen: `construct` is reclaimed as the record's (free,
    // "from a feat"), `tough` survives as a legitimate player pick, and the two counters AGREE on 1.
    const b = familiar({ grantSlug: 'alchemical-familiar', abilities: ['construct', 'tough'] });
    expect(b.hp).toBe(28);
    expect(b.abilities.find((a) => a.id === 'construct')?.fromFeat).toBe('alchemical-familiar');
    expect(b.abilities.filter((a) => !a.fromFeat).map((a) => a.id)).toEqual(['tough']);
  });
});

/* ================================================================== Advanced Weaponry (the eidolon) */

const eidolonOf = (over: Partial<BuildState>) =>
  deriveEidolon({ id: 'e', kind: 'eidolon', name: 'E', eidolon: {} } as never, build('summoner', 7, over), db);

/** Advanced Weaponry in a level-1 class slot: the trait in `featChoices`, the attack in `effectChoices`. */
const advancedWeaponry = (trait?: string, attack?: string) =>
  eidolonOf({
    featPicks: { '1:class': 'advanced-weaponry' } as BuildState['featPicks'],
    ...(trait ? { featChoices: { '1:class': trait } as BuildState['featChoices'] } : {}),
    ...(attack ? { effectChoices: { 'advanced-weaponry:eidolon-attack': attack } } : {}),
  } as Partial<BuildState>);

describe('Advanced Weaponry puts the chosen trait on the chosen Strike', () => {
  it('the record asks BOTH printed questions and no longer admits it is inert', () => {
    // "Choose one of your eidolon's starting melee unarmed attacks. It gains one of the following
    // traits…" — two questions. The record asked only the second.
    expect(db.feats['advanced-weaponry'].choice?.inert).toBeUndefined();
    expect(db.feats['advanced-weaponry'].effectChoices?.[0].id).toBe('eidolon-attack');
    // Two options is load-bearing: resolvePick auto-applies a ONE-option choice even unanswered.
    expect(db.feats['advanced-weaponry'].effectChoices?.[0].options?.map((o) => o.value)).toEqual(['primary', 'secondary']);
  });

  it('the secondary attack gains grapple, and the primary does not', () => {
    const b = advancedWeaponry('grapple', 'secondary');
    expect(b.attacks[1].traits).toContain('grapple');
    expect(b.attacks[0].traits).not.toContain('grapple');
    expect(b.evoNotes?.join(' ')).toContain('its Secondary unarmed attack gains the grapple trait');
  });

  it('a versatile answer lands as the app’s own suffixed trait, and the note names the damage type', () => {
    const b = advancedWeaponry('versatile-bludgeoning', 'primary');
    expect(b.attacks[0].traits).toContain('versatile-b');
    expect(b.attacks[1].traits).not.toContain('versatile-b');
    expect(b.evoNotes?.join(' ')).toContain('versatile B');
    expect(b.evoNotes?.join(' ')).toContain('bludgeoning damage instead of its listed type');
  });

  it('a half-answered pick never picks for the player', () => {
    const b = advancedWeaponry('grapple');
    expect(b.attacks[0].traits).not.toContain('grapple');
    expect(b.attacks[1].traits).not.toContain('grapple');
    expect(b.evoNotes?.join(' ')).toContain("choose the trait AND which of the eidolon's starting melee unarmed attacks");
  });

  it('without the feat the eidolon’s Strikes are unchanged', () => {
    const b = eidolonOf({});
    expect(b.attacks[0].traits).toEqual(['forceful', 'sweep', 'unarmed']);
    expect(b.attacks[1].traits).toEqual(['agile', 'finesse', 'unarmed']);
    expect(b.evoNotes?.join(' ') ?? '').not.toContain('Advanced Weaponry');
  });
});

/* ========================================================== Animal Companion (Ranger) — Hunt Prey */

describe('Animal Companion (Ranger) delivers its second sentence', () => {
  const TYPE_ID = Object.keys(db.animalCompanions)[0];
  const ranger = (subclassId: string) =>
    build('ranger', 4, { subclassId, featPicks: { '1:class': 'animal-companion-ranger' } as BuildState['featPicks'] });
  const companion = (ch: ReturnType<typeof build>, edge: string | null) =>
    deriveAnimalCompanion(
      { id: 'c', kind: 'animal', name: 'Pet', typeId: TYPE_ID } as CompanionConfig,
      db.animalCompanions[TYPE_ID],
      4,
      db,
      [],
      false,
      [],
      companionModKeys(ch.feats),
      edge,
    );

  it('huntersEdgeName reads the ranger’s subclass, and nothing else’s', () => {
    expect(huntersEdgeName(ranger('precision'), db)).toBe('Precision');
    expect(huntersEdgeName(ranger('flurry'), db)).toBe('Flurry');
    expect(huntersEdgeName(build('fighter', 4, {}), db)).toBeNull();
  });

  it('the companion card names the edge the character actually has', () => {
    const ch = ranger('precision');
    expect(companion(ch, huntersEdgeName(ch, db)).modNotes?.join(' ')).toContain("your Precision hunter's edge benefit");
  });

  it('and says "if you have one" when the owner has none (an archetype ranger)', () => {
    const ch = ranger('precision');
    expect(companion(ch, null).modNotes?.join(' ')).toContain("hunter's edge benefit if you have one");
  });

  it('a companion whose owner does NOT have the feat gets no note', () => {
    const ch = build('ranger', 4, { subclassId: 'precision' });
    expect(companion(ch, 'Precision').modNotes?.join(' ') ?? '').not.toContain('Animal Companion (Ranger)');
  });

  it('the character’s own half is a mark on the Hunt Prey action', () => {
    const ch = ranger('precision');
    const marks = recordMarkersFor(ch, db, 'action', 'hunt-prey');
    expect(marks.some((m) => m.sourceId === 'animal-companion-ranger')).toBe(true);
    expect(recordMarkersFor(build('fighter', 4, {}), db, 'action', 'hunt-prey')).toEqual([]);
  });
});

/* ============================================ the mark tooltip that printed every name twice */

describe('a record mark names its source exactly once', () => {
  it('markTooltip strips a note’s own leading record name', () => {
    // MEASURED live before the fix: the Hunt Prey row's tooltip read "Animal Companion (Ranger):
    // Animal Companion (Ranger): when you Hunt Prey…". 40 of the 119 RECORD_MARKERS entries write the
    // note that way and all three renderers prefix the name, so a third of the table printed it twice.
    const doubled = { sourceId: 'weapon-supremacy', note: "Weapon Supremacy: you're permanently quickened." };
    expect(markTooltip(db, [doubled])).toBe("Weapon Supremacy: you're permanently quickened.");
    expect(markNote(db, doubled)).toBe("you're permanently quickened.");
  });

  it('and leaves a note that does NOT repeat it alone', () => {
    const plain = { sourceId: 'weapon-supremacy', note: 'you get an extra action.' };
    expect(markTooltip(db, [plain])).toBe('Weapon Supremacy: you get an extra action.');
    expect(markNote(db, plain)).toBe('you get an extra action.');
  });

  it('no rendered mark prints its record name twice, for any record in the table', () => {
    // The whole table, not the two above: the fix is at render time precisely because 26 of the 40
    // live inside a block scripts/apply-feature-audit.mjs regenerates whole, so a data fix would not
    // have held. This asserts the property for every entry at once.
    const bad: string[] = [];
    for (const [id, marks] of Object.entries(RECORD_MARKERS)) {
      const name = nameOfRecord(db, id);
      if (!name || name === id) continue;
      for (const m of marks) {
        const rendered = markTooltip(db, [{ sourceId: id, note: m.note }]);
        if (rendered.startsWith(`${name}: ${name}:`)) bad.push(id);
      }
    }
    expect(bad).toEqual([]);
  });
});

/* ================================================================================== the scanner */

describe('scan:companion-locks — the guard for the whole shape', () => {
  it('every record printing an always-present familiar ability agrees with the grant table', () => {
    const bad = auditCompanionLocks().filter((r: { problems: string[] }) => r.problems.length);
    expect(bad.map((r: { id: string; problems: string[] }) => `${r.id}: ${r.problems[0]}`)).toEqual([]);
  });

  it('it covers more than the three records the audit named', () => {
    // 11 records carry the clause; the audit named one of them. Ratchet: this may only go UP.
    expect(auditCompanionLocks().length).toBeGreaterThanOrEqual(11);
  });

  it('and it DISCRIMINATES — a table with the flag on the wrong record fails', () => {
    // A scanner nobody has seen fail is not evidence. Both directions, on real records.
    const overpaid = auditCompanionLocks({ ...FEAT_COMPANION_GRANTS, 'corgi-mount': { ...FEAT_COMPANION_GRANTS['corgi-mount'], lockedFree: true } });
    expect(overpaid.find((r: { id: string }) => r.id === 'corgi-mount')!.problems[0]).toMatch(/COUNTS against the budget/);
    const underpaid = auditCompanionLocks({ ...FEAT_COMPANION_GRANTS, 'alchemical-familiar': { ...FEAT_COMPANION_GRANTS['alchemical-familiar'], lockedFree: undefined } });
    expect(underpaid.find((r: { id: string }) => r.id === 'alchemical-familiar')!.problems[0]).toMatch(/does NOT count against the budget/);
    const missing = auditCompanionLocks({ ...FEAT_COMPANION_GRANTS, 'star-orb': { ...FEAT_COMPANION_GRANTS['star-orb'], lockedAbilities: [] } });
    expect(missing.find((r: { id: string }) => r.id === 'star-orb')!.problems[0]).toMatch(/`lockedAbilities` is empty/);
  });
});
