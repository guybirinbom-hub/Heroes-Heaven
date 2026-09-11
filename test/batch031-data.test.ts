import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { applyEditionFilter } from '../src/rules/build';
import type { ContentDatabase, StanceDef } from '../src/rules/types';

/**
 * Batch-031, WG-comparison lane — the DATA-ROWS family.
 *
 * Every assertion below reads `public/core.json` (plus `public/core-descriptions.json`) through
 * `content()` and pins the field the driver's backfill row authors, so each test fails today for
 * exactly one reason — the field is absent or wrong — and passes once the row lands. Nothing here
 * compares a patched copy against the shipped one, so no assertion flips when the row is applied.
 */
const db = () => content();
const feat = (id: string) => db().feats[id] as Record<string, unknown> | undefined;
type Mark = { on: string; id: string; note: string };

describe('soulsight-sorcerer is the superseded half of one printed feat', () => {
  // batch 031: soulsight-sorcerer#duplicate
  it('is hidden from the picker, leaving a single Soulsight on feat-4609', () => {
    // "Soulsight … You gain spiritsense as an imprecise sense with a range of 60 feet" (AoN
    // feat-4609) is ONE feat with the Bard AND Sorcerer traits; we shipped three pickable records on
    // that aonId. `edition: 'superseded'` is the value applyEditionFilter always drops.
    expect(feat('soulsight')?.edition).toBe('remaster');
    expect(feat('soulsight-sorcerer')?.edition).toBe('superseded');
    expect(feat('soulsight-bard')?.edition).toBe('superseded');
    const visible = applyEditionFilter(db(), { hideLegacy: false }, new Set<string>());
    expect(Object.keys(visible.feats).filter((id) => id.startsWith('soulsight'))).toEqual(['soulsight']);
  });
});

describe('spellshield surfaces its infusion on Drain Bonded Item', () => {
  // batch 031: spellshield#infusion
  it('marks the granted action with the prepared-slot trade and the automatic heightening', () => {
    // "When you Drain your Bonded Item to Cast a Spell, that spell is automatically heightened to the
    // rank of spell you infused into your shield" (AoN feat-7983) fires AT the action, so the row the
    // player reads when using it is the only surface that can carry it.
    expect(db().actions['drain-bonded-item']).toBeTruthy();
    const marks = feat('spellshield')?.recordMarks as Mark[] | undefined;
    expect(marks?.map((m) => `${m.on}:${m.id}`)).toEqual(['action:drain-bonded-item']);
    expect(marks?.[0].note).toMatch(/one fewer wizard spell/i);
    expect(marks?.[0].note).toMatch(/automatically heightened/i);
  });
});

describe('greater-cruelty reaches the spell Cruelty modifies', () => {
  // batch 031: greater-cruelty
  it('notes the clumsy/stupefied substitution on Touch of the Void', () => {
    // "you can choose to make the target clumsy or stupefied instead, with the same condition value"
    // (AoN feat-5903) modifies the same spell feats/cruelty already annotates through spellNotes.
    const notes = feat('greater-cruelty')?.spellNotes as { spellId: string; note: string }[] | undefined;
    expect(notes?.map((n) => n.spellId)).toEqual(['touch-of-the-void']);
    expect(notes?.[0].note).toMatch(/clumsy or stupefied/i);
    expect(notes?.[0].note).toMatch(/same condition value/i);
  });
});

describe('ouroboric-pact is a passive feat that grants an activity', () => {
  // batch 031: ouroboric-pact#action-cost
  it('leaves the Free Action on Entreat Pact instead of duplicating it on the feat', () => {
    // AoN feat-7448's title carries no action glyph — the Free Action is on the granted activity's
    // own "Activate" line — and we ship actions/entreat-pact with that cost already, so the copy on
    // the feat rendered a second free-action row.
    expect((feat('ouroboric-pact')?.actionCost as { type: string })?.type).toBe('passive');
    expect(feat('ouroboric-pact')?.grantsActions).toEqual(['entreat-pact']);
    expect((db().actions['entreat-pact']?.actionCost as { type: string })?.type).toBe('free');
  });
});

describe('flickering-stories marks Offer a Story', () => {
  // batch 031: flickering-stories
  it('carries the shadow-concealment alternative on the action it changes', () => {
    // "When you Offer a Story, you can become concealed by shifting shadows for the duration instead
    // of the normal benefits. The action then gains the shadow trait." (AoN feat-7444)
    expect(db().actions['offer-story']).toBeTruthy();
    const marks = feat('flickering-stories')?.recordMarks as Mark[] | undefined;
    expect(marks?.map((m) => `${m.on}:${m.id}`)).toEqual(['action:offer-story']);
    expect(marks?.[0].note).toMatch(/shadow trait/i);
    expect(marks?.[0].note).toMatch(/can't use this concealment to Hide|can't Hide/i);
  });
});

describe('dream-magic grants its spell at the printed rank', () => {
  // The rank this batch-031 finding established is unchanged; only its CARRIER moved. "Special You
  // can take this feat twice, gaining the spell you didn't select initially the second time" (AoN
  // feat-8518) — an effectChoices answer is keyed by record id, so both takings shared it, and the
  // pick moved to the record's own `choice`, which is answered per feat entry.
  // batch 037: dream-magic#second-taking
  it('dream-magic offers Dream Message or Sleep as a 4th-rank occult innate spell, once per day', () => {
    // "you learn this spell as a 4th-rank occult innate spell that you can cast once per day" (AoN
    // feat-8518). The FEAT_CANTRIP_GRANTS lane carries no rank at all, so both spells were cast at
    // their base rank; a choice option's grant.innateSpells can carry it.
    const choice = feat('dream-magic')?.choice as
      | { options: { value: string; grant: { innateSpells: { spellId: string; tradition: string; rank: number; usesPerDay: number }[] } }[] }
      | undefined;
    // The old shape was a one-entry effectChoices ARRAY, so this line lost its `?.[0]` when the pick
    // moved onto the record's own `choice`; the two options it names are unchanged.
    // batch 037: dream-magic#second-taking
    expect(choice?.options.map((o) => o.value).sort()).toEqual(['dream-message', 'sleep']);
    for (const o of choice?.options ?? []) {
      expect(o.grant.innateSpells).toEqual([
        { spellId: o.value, tradition: 'occult', rank: 4, usesPerDay: 1 },
      ]);
    }
  });

  // batch 031: dream-magic#attribute
  it('casts it off Wisdom at trained proficiency, not the innate default of Charisma', () => {
    // "You become trained in the spell attack modifier and spell DC statistics, and your spellcasting
    // attribute for these spells is Wisdom." (AoN feat-8518)
    expect(feat('dream-magic')?.spellcastingGrant).toEqual({
      tradition: 'occult',
      keyAbility: 'wis',
      proficiency: 'trained',
    });
  });
});

describe('clinging-shadows-initiate delivers the shadow grasp Strike', () => {
  // batch 031: clinging-shadows-initiate#shadow-grasp
  it('registers a stance def for the qi spell so the Strike has a carrier', () => {
    // "You can make shadow grasp Strikes. These deal 1d4 void damage; are in the brawling group; and
    // have the agile, grapple, reach, and unarmed traits." (AoN spell-2061, granted by feat-6010).
    // Stance defs are keyed by the record id that carries the stance — here a SPELL.
    expect(feat('clinging-shadows-initiate')?.focusSpells).toEqual(['clinging-shadows-stance']);
    const def = db().stances['clinging-shadows-stance'] as StanceDef | undefined;
    expect(def?.strikes).toEqual([
      { name: 'shadow grasp', dice: 1, die: 'd4', damageType: 'void', group: 'brawling', traits: ['agile', 'grapple', 'reach', 'unarmed'] },
    ]);
    // The +2 is a CIRCUMSTANCE bonus on Grapple/Escape only, and StanceDef has no conditional-bonus
    // field, so it is stated rather than applied — an unconditional acBonus would be a bigger error.
    expect(def?.acBonus).toBeUndefined();
    expect(def?.note).toMatch(/Escape from you/i);
  });
});

describe('steal-vitality names the conditions without a value', () => {
  // batch 031: steal-vitality#condition-values
  it('reads "the clumsy or enfeebled conditions", and links them at those labels', () => {
    // AoN feat-3389 prints "remove the clumsy or enfeebled conditions on yourself" with no value;
    // ours said "Clumsy 1 or Enfeebled 1", which reads as ineligible to a player with clumsy 2.
    const d = feat('steal-vitality')?.description as string | undefined;
    expect(d).toMatch(/remove the clumsy or enfeebled conditions on yourself/);
    expect(d).not.toMatch(/Clumsy 1|Enfeebled 1/);
    // The remaster renames our text legitimately carries are left in place.
    expect(d).toMatch(/Vampiric Feast/);
    const refs = feat('steal-vitality')?.descRefs as { label: string; key: string }[] | undefined;
    expect(refs).toEqual([
      { label: 'clumsy', key: 'conditions' },
      { label: 'enfeebled', key: 'conditions' },
      { label: 'Vampiric Feast', key: 'spells' },
    ]);
  });
});

describe('swashbucklers-speed prints its own edition’s text', () => {
  // batch 031: swashbucklers-speed#text
  it('carries the Player Core 2 sentence, not the word-dropped legacy one', () => {
    // The record is source Player Core 2, aonId feat-6238: "You move with a swashbuckler's speed and
    // grace. You gain a +5-foot status bonus to your Speeds; this increases to a +10-foot status
    // bonus while you have panache." We shipped legacy feat-1864's sentence minus its last word.
    expect(feat('swashbucklers-speed')?.aonId).toBe('feat-6238');
    const d = feat('swashbucklers-speed')?.description as string | undefined;
    expect(d).not.toMatch(/with or without \./);
    expect(d).toMatch(/\+5-foot status bonus to your Speeds; this increases to a \+10-foot status bonus while you have panache/);
  });
});

describe('wild-winds-initiate delivers the wind crash Strike', () => {
  // batch 031: wild-winds-initiate#stance
  it('registers a stance def for the qi spell with the ranged unarmed Strike', () => {
    // "You can make wind crash unarmed Strikes as ranged Strikes against targets within 30 feet.
    // These deal 1d6 bludgeoning damage; are in the brawling group; and have the agile, nonlethal,
    // propulsive, and unarmed traits." (AoN spell-2062)
    expect(feat('wild-winds-initiate')?.focusSpells).toEqual(['wild-winds-stance']);
    const def = db().stances['wild-winds-stance'] as StanceDef | undefined;
    // batch 031: wild-winds-initiate#stance
    // `range: 30` is the printed "as ranged Strikes against targets within 30 feet", folded into the
    // create row by the closer: the gap lane set the same field separately, so the shipped record could
    // never equal a create row that omitted it (the apply post-check refused on exactly that).
    expect(def?.strikes).toEqual([
      { name: 'wind crash', dice: 1, die: 'd6', damageType: 'bludgeoning', group: 'brawling', traits: ['agile', 'nonlethal', 'propulsive', 'unarmed'], range: 30 },
    ]);
    // The +2 AC is against RANGED attacks only; StanceDef.acBonus is unconditional, so it is stated.
    expect(def?.acBonus).toBeUndefined();
    expect(def?.note).toMatch(/30 feet/);
    expect(def?.note).toMatch(/ranged attacks/i);
  });
});

describe('sinister-knight is a rune that can actually be etched', () => {
  // batch 031: sinister-knight
  it('exists in the runes catalog as an armor property rune carrying its +1 Deception', () => {
    // AoN equipment-518: "Usage etched onto heavy armor … The wearer gains a +1 item bonus to
    // Deception checks." planAttach looks the id up in content.runes; with no entry the etch was
    // refused outright and the bonus only fired if the loose rune was mislabelled as worn.
    const rune = db().runes['sinister-knight'];
    expect(rune).toBeTruthy();
    expect(rune?.slot).toBe('armor');
    expect(rune?.kind).toBe('property');
    expect(rune?.passiveEffects?.skills).toEqual({ deception: 1 });
    expect(db().items['sinister-knight']?.usage).toBe('etched-onto-heavy-armor');
  });
});

describe('umbral-wings can be activated for its fly Speed', () => {
  // batch 031: umbral-wings#fly-activation
  it('has an item mode granting a fly Speed equal to your land Speed', () => {
    // "Activate [1] envision; Frequency once per hour; Effect You gain a fly Speed equal to your Speed
    // until the end of your next turn." (AoN equipment-1719) — the item carried the cost and the
    // frequency counter but no Speed anywhere, so the number reached no sheet.
    const modes = db().modes as Record<string, { fromItemId?: string; speeds?: Record<string, string | number>; duration?: string; note?: string }>;
    const m = modes['item-umbral-wings'];
    expect(m?.fromItemId).toBe('umbral-wings');
    expect(m?.speeds).toEqual({ fly: '@actor.speed.land' });
    expect(m?.duration).toMatch(/end of your next turn/i);
    expect(db().items['umbral-wings']?.frequency).toEqual({ max: 1, per: 'hour' });
  });
});

describe('energy-robe-cold can be activated for its water walk', () => {
  // batch 031: energy-robe-cold#water-walk
  it('has an item mode naming the 1-minute water walk the activation grants', () => {
    // "When the robe is activated, you gain the effects of water walk for 1 minute" (AoN
    // equipment-1317-1217). Water walk moves no derived number, so this is the note-only activation
    // mode — the shape modes/item-warming-parka already uses.
    const modes = db().modes as Record<string, { fromItemId?: string; duration?: string; note?: string }>;
    const m = modes['item-energy-robe-cold'];
    expect(m?.fromItemId).toBe('energy-robe-cold');
    expect(m?.duration).toBe('1 minute');
    expect(m?.note).toMatch(/water walk/i);
    expect(db().items['energy-robe-cold']?.frequency).toEqual({ max: 1, per: 'day' });
  });
});
