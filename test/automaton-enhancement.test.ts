import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { build, content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { deriveDefenses, deriveStrikes } from '../src/rules/derive';
import { explainStat } from '../src/rules/explain';
import { featEntries } from '../src/sheet/FeatsTab';
import { senseDesc } from '../src/rules/glossary';
import { audit as scanEnhancements, EXEMPT } from '../scripts/scan-enhancements.mjs';
import type { Character } from '../src/rules/types';

const db = content();

/**
 * THE AUTOMATON ENHANCEMENT TIER — a benefit a record PRINTS but only HAS while another record
 * names it.
 *
 * Nineteen automaton ancestry feats print a base benefit and then an "**Enhancement**" paragraph.
 * You gain that paragraph only by pointing an augmentation at the feat: Lesser Augmentation (AoN
 * feat-3103) — *"You gain the enhancement benefits of one of your 1st- or 5th-level automaton
 * ancestry feats"*. Both augmentations already shipped the picker; NOTHING under src/ read the
 * answer, and the picker's own prompt admitted it ("prose benefit — read that feat's Enhancement
 * entry"). Owner ruling **Q26**: a dead picker is a MISSING LANE, not flavour.
 *
 * Every assertion below is written against a value that was measured on the UNPATCHED tree, so each
 * one discriminates:
 *   · arcane-eye's innate list was `{2:['see-the-unseen']}` at LEVEL 1 — a spell a 1st-level
 *     character cannot cast, granted flatly by a record whose text gates it behind the tier;
 *   · the enhanced Claw read `1d4+4 S`;
 *   · arcane-communication changed nothing at all — no sense, no note, no field;
 *   · automaton-lore had no `effectChoices`, so the Arcana-or-Crafting sentence asked nothing.
 */

/** An automaton fighter. Ancestry feat slot keys are `<level>:ancestry`; a feat's OWN choice answer
 *  is stored under the SLOT key (`featChoices`), not under the feat id. */
const auto = (level: number, featPicks: Record<string, string>, over: Partial<BuildState> = {}): Character =>
  build('fighter', level, { ancestryId: 'automaton', featPicks, ...over });

const lesser = (target: string, extra: Record<string, string> = {}) => ({
  effectChoices: { 'lesser-augmentation:enhancement': target, ...extra },
});

const innateOf = (ch: Character) => ch.spellcasting.filter((e) => e.type === 'innate');

describe('the tier is inert until an augmentation names the feat', () => {
  it('Arcane Eye grants NO innate spell at 1st level — the text gates it behind the Enhancement', () => {
    // Before: `innateSpells: [{spellId:'see-the-unseen', tradition:'arcane'}]` on the record itself,
    // so this returned an entry with repertoire {2:['see-the-unseen']} on a level-1 character.
    expect(innateOf(auto(1, { '1:ancestry': 'arcane-eye' }))).toEqual([]);
    expect(auto(1, { '1:ancestry': 'arcane-eye' }).enhancements).toBeUndefined();
  });

  it('…and it arrives with the tier, at the printed cadence and attributed to the FEAT', () => {
    const ch = auto(9, { '1:ancestry': 'arcane-eye', '9:ancestry': 'lesser-augmentation' }, lesser('arcane-eye'));
    expect(ch.enhancements).toEqual([{ featId: 'arcane-eye', from: 'Lesser Augmentation' }]);
    const e = innateOf(ch)[0];
    expect(e.repertoire?.[2]).toContain('see-the-unseen');
    // "once per hour", not the 1/day the engine defaults to — SpellsTab renders innateCadence.
    expect(e.innateCadence?.['see-the-unseen']).toBe('1/hour');
    // The player will look this up on Arcane Eye, not on the augmentation.
    expect(e.spellSources?.['see-the-unseen']).toBe('Arcane Eye (Enhancement)');
  });

  it('an answer naming a feat the character does NOT own grants nothing', () => {
    // A retrain can leave the answer behind. Without the takenFeats guard this hands out a free tier.
    const ch = auto(9, { '9:ancestry': 'lesser-augmentation' }, lesser('arcane-eye'));
    expect(ch.enhancements).toBeUndefined();
    expect(innateOf(ch)).toEqual([]);
  });
});

describe('Automaton Armament — the die is a VALUE on the row, with its source in the breakdown', () => {
  const armament = (pick: string, enhanced: boolean) =>
    auto(
      9,
      enhanced ? { '1:ancestry': 'automaton-armament', '9:ancestry': 'lesser-augmentation' } : { '1:ancestry': 'automaton-armament' },
      { featChoices: { '1:ancestry': pick }, ...(enhanced ? lesser('automaton-armament') : {}) },
    );
  const strike = (pick: string, enhanced: boolean) => {
    const name = pick === 'claw' ? 'Claw' : 'Pincer';
    return deriveStrikes(armament(pick, enhanced), db).find((s) => s.name === name)!;
  };

  it('steps the claw 1d4 → 1d6 and the pincer 1d6 → 1d8, exactly as printed', () => {
    // "Increase the damage die of the unarmed attack you gain from this feat by one step (from 1d4 to
    // 1d6, or from 1d6 to 1d8)" — mirror feat-3090. Measured before: both rows kept their base die.
    expect(strike('claw', false).damage).toContain('1d4');
    expect(strike('claw', true).damage).toContain('1d6');
    expect(strike('pincer', false).damage).toContain('1d6');
    expect(strike('pincer', true).damage).toContain('1d8');
  });

  it("the damage breakdown NAMES what enlarged the die — Q31's rule for a changed progression", () => {
    // Principle C: a feat that modifies another record's granted thing must be reflected in that
    // thing. A bigger die with nothing explaining it reads as a bug, which is the half of the
    // audit's clause ("attributed to the Enhancement") a bare value would leave unanswered.
    const on = armament('claw', true);
    const s = deriveStrikes(on, db).find((x) => x.name === 'Claw')!;
    expect(s.dieNote).toContain('Automaton Armament');
    expect(explainStat(on, db, { kind: 'strikeDamage', instanceId: s.instanceId }).description).toContain(
      "Its damage die is stepped up by Automaton Armament's Enhancement.",
    );
    // …and an UNenhanced claw carries no such sentence.
    const off = armament('claw', false);
    const t = deriveStrikes(off, db).find((x) => x.name === 'Claw')!;
    expect(t.dieNote).toBeUndefined();
    expect(explainStat(off, db, { kind: 'strikeDamage', instanceId: t.instanceId }).description).not.toContain('Enhancement');
  });
});

describe('Automaton Lore — a picker that exists only while the tier runs', () => {
  it('is not resolved while inert, even with an answer stored', () => {
    // Q27: a control whose answer nothing applies must not be live. The stored answer is honoured
    // nowhere and leaves no `effectPicks` echo either, so the sheet does not claim a choice was made.
    const ch = auto(9, { '1:ancestry': 'automaton-lore' }, { effectChoices: { 'automaton-lore:enhancement-rank': 'arcana' } });
    expect(ch.proficiencies.skills.arcana).toBe('trained');
    expect(ch.proficiencies.skills.crafting).toBe('trained');
    expect((ch.effectPicks ?? []).some((p) => p.choiceId === 'enhancement-rank')).toBe(false);
  });

  it('…and raises exactly the chosen skill once it does', () => {
    const ch = auto(
      9,
      { '1:ancestry': 'automaton-lore', '9:ancestry': 'lesser-augmentation' },
      lesser('automaton-lore', { 'automaton-lore:enhancement-rank': 'arcana' }),
    );
    expect(ch.proficiencies.skills.arcana).toBe('expert');
    expect(ch.proficiencies.skills.crafting).toBe('trained');
  });

  it('UPGRADES, never sets — an already-master Arcana is not dropped to expert', () => {
    // The grant runs through maxRank. A plain assignment would silently demote a character who spent
    // two skill increases on Arcana, and both options stay live precisely because this is safe.
    const ch = auto(
      9,
      { '1:ancestry': 'automaton-lore', '9:ancestry': 'lesser-augmentation' },
      { skillIncreases: { 3: 'arcana', 5: 'arcana', 7: 'arcana' }, ...lesser('automaton-lore', { 'automaton-lore:enhancement-rank': 'arcana' }) },
    );
    expect(ch.proficiencies.skills.arcana).toBe('master');
    // the control: the same three increases WITHOUT the tier land on master too, so the assertion is
    // about the grant not lowering the rank rather than about the increases.
    const control = auto(9, { '1:ancestry': 'automaton-lore' }, { skillIncreases: { 3: 'arcana', 5: 'arcana', 7: 'arcana' } });
    expect(control.proficiencies.skills.arcana).toBe('master');
  });

  it('the Arcana redundancy fallback is untouched by the tier', () => {
    // build.ts exempts `lore:` keys from the redundantFallback branch, and the gated choice must not
    // disturb the existing collision picker either.
    const wiz = buildCharacter(
      { ...emptyBuild(), name: 't', level: 9, classId: 'wizard', ancestryId: 'automaton', backgroundId: Object.keys(db.backgrounds)[0], keyAbility: 'int', subclassId: null, featPicks: { '1:ancestry': 'automaton-lore' } } as BuildState,
      db,
    );
    expect(wiz.skillFallbacks).toEqual([{ featId: 'automaton-lore', skill: 'arcana' }]);
  });

  /**
   * ⚠ MEASURED, AND DELIBERATELY NOT "FIXED".
   *
   * The fix plan called for `FEAT_SKILL_GRANTS['automaton-lore'].skills['lore:automaton'] =
   * 'trained'`, on the premise that the granted Additional Lore never receives its subject. That
   * premise is FALSE on this tree: `featFeatGrants.ts` binds the grant with
   * `{ kind: 'fixedLore', lore: 'automaton' }`, which routes through the Additional Lore FEAT and so
   * also picks up its 3rd/7th/15th skill increases.
   *
   * Building at six levels with the flat key present and absent gave IDENTICAL ranks, so adding it
   * would have been a second registry for one fact — and a WORSE one, since the flat form trains and
   * never raises (the sibling `android-lore`, which has only the flat grant, is still `trained` at
   * level 20). This test is what stops that edit being re-proposed.
   */
  it('the Automaton Lore subject is trained AND climbs, via the granted Additional Lore', () => {
    expect(auto(1, { '1:ancestry': 'automaton-lore' }).proficiencies.skills['lore:automaton']).toBe('trained');
    expect(auto(9, { '1:ancestry': 'automaton-lore' }).proficiencies.skills['lore:automaton']).toBe('master');
  });
});

describe('Arcane Communication — one sense pill, not two', () => {
  const tele = (ch: Character) => deriveDefenses(ch, db).senses.filter((s) => s.name === 'touch-telepathy');

  it('gains touch telepathy at all (the record used to grant nothing whatever)', () => {
    const off = tele(auto(9, { '1:ancestry': 'arcane-communication' }));
    expect(off).toHaveLength(1);
    expect(off[0].range).toBeFalsy(); // senseLabel hides a 0, so the pill reads "Touch Telepathy"
  });

  it('and the tier REPLACES it with the 10-foot version rather than adding a second row', () => {
    // ⚠ `range: 0` on the base entry is load-bearing: addSense compares with `r ?? Infinity`, so an
    // ABSENT range beats 10 and the enhanced telepathy would lose to its own base entry.
    const on = tele(auto(9, { '1:ancestry': 'arcane-communication', '9:ancestry': 'lesser-augmentation' }, lesser('arcane-communication')));
    expect(on).toHaveLength(1);
    expect(on[0].range).toBe(10);
  });

  it('the pill has a real description, not the generic "a special sense" fallback', () => {
    expect(senseDesc('touch-telepathy')).toContain('communicate silently and mentally');
  });

  it('and the name is a recognised sense SELECTOR, not prose parked on the Senses row', async () => {
    /* The senses-display cluster's SHAPE-2 guard rejects any `senses[].name` outside its census, and
     * it was right to make this a stated decision. Touch telepathy is a named PF2e creature ability
     * with a RANGE that another record extends — the only shape `senses` models and the only lane the
     * Enhancement half could land in — unlike the ten accepted item entries, which are sentences
     * ("see four times farther than normal"). Asserted through the scanner's own set, never a copy. */
    const { KNOWN_SENSES, norm } = (await import('../scripts/scan-sense-lane.mjs')) as {
      KNOWN_SENSES: Set<string>; norm: (s: string) => string;
    };
    expect(KNOWN_SENSES.has(norm('touch-telepathy'))).toBe(true);
  });
});

describe('the display half — the one fact the printed text cannot carry is that YOU have it', () => {
  it('FeatDetail is told which record turned the tier on', () => {
    // Rendered as its own row rather than appended to `description`: DescBody renders from the ast
    // whenever one exists (all six records are in public/ast/feats.json.gz) and discards the string.
    const on = auto(
      9,
      { '1:ancestry': 'automaton-armament', '9:ancestry': 'lesser-augmentation' },
      { featChoices: { '1:ancestry': 'claw' }, ...lesser('automaton-armament') },
    );
    const off = auto(9, { '1:ancestry': 'automaton-armament' }, { featChoices: { '1:ancestry': 'claw' } });
    expect(featEntries(on, db).find((e) => e.featId === 'automaton-armament')?.enhancedBy).toBe('Lesser Augmentation');
    expect(featEntries(off, db).find((e) => e.featId === 'automaton-armament')?.enhancedBy).toBeUndefined();
  });

  it("each augmentation option says whether the app computes it — the honest Q27 answer", () => {
    for (const id of ['lesser-augmentation', 'greater-augmentation']) {
      const ch = db.feats[id].effectChoices?.find((c) => c.id === 'enhancement');
      expect(ch, `${id} lost its enhancement choice`).toBeTruthy();
      for (const o of ch!.options ?? []) expect(o.note, `${id} -> ${o.value} has no note`).toBeTruthy();
      // 4 -> 5 -> 6: Undead Hunter's Infuse Vitality (batch 4) and Powerful Tail's climb Speed
      // (batch 6) are both computed now.
      expect((ch!.options ?? []).filter((o) => /Computed on your sheet/.test(o.note ?? ''))).toHaveLength(6);
    }
    // The old note claimed "this feat's effect is one the app does not compute". It now does.
    expect(db.feats['lesser-augmentation'].note).not.toContain('does not compute');
  });
});

/**
 * THE CORPUS GUARD.
 *
 * The audit named four records. `npm run scan:enhancements` reads the printed text of every record in
 * six collections and buckets each one; run against the PRE-FIX data it reported 18 TO DO and 0
 * computed, so it discriminates. These assertions are the ratchet.
 */
describe('every record printing an **Enhancement** is accounted for', () => {
  const a = scanEnhancements() as {
    printing: unknown[]; computed: string[]; proseOnly: string[]; silent: string[];
    unreachable: string[]; exempt: string[]; spurious: string[]; badOption: string[];
    optionWithoutNote: string[]; badGate: string[];
  };

  /*
   * ⚠ 19 -> 30. The scanner's marker was `**Enhancement**` only, and some records' plain-text
   * descriptions lose their bold markers in the AoN import (Undead Hunter's reads a bare line-start
   * "Enhancement You can infuse…"). Eleven records printing a tier were invisible to the scan, and all
   * eleven were offered by NEITHER Augmentation picker — their benefit was unreachable. Found while
   * authoring Undead Hunter, which the old marker then reported as SPURIOUS.
   */
  it('30 print one, 6 are computed, 23 carry a note, 1 is exempt with a stated reason', () => {
    expect(a.printing).toHaveLength(30);
    expect(a.computed.sort()).toEqual([
      'feats/arcane-communication', 'feats/arcane-eye', 'feats/automaton-armament', 'feats/automaton-lore',
      'feats/powerful-tail', 'feats/undead-hunter',
    ]);
    expect(a.proseOnly).toHaveLength(23);
    expect(Object.keys(EXEMPT)).toEqual(['feats/lesser-augmentation']);
  });

  it('none is silent, and none is unreachable', () => {
    // "silent" = prints a tier, the app models nothing, and no option says so — the state all 18
    // reachable records were in before this pass.
    expect(a.silent).toEqual([]);
    expect(a.unreachable).toEqual([]);
  });

  it('no record grants a tier its text does not print, and every option resolves', () => {
    expect(a.spurious).toEqual([]);
    expect(a.badOption).toEqual([]);
    expect(a.optionWithoutNote).toEqual([]);
  });

  it('no gated choice has fewer than two options — resolvePick auto-applies a one-option choice', () => {
    // THE TRAP THIS LANE EXISTS BECAUSE OF. `resolvePick` falls back to `opts[0]` when a choice has
    // exactly one option and no answer, so authoring the payload as a one-option picker delivers
    // every tier unconditionally. That is why `enhancement.grant` exists at all.
    expect(a.badGate).toEqual([]);
  });
});

describe('the authored data survives a regeneration', () => {
  const overlay = JSON.parse(readFileSync('scripts/data/effect-backfill.json', 'utf8')) as {
    category: string; id: string; field: string; value: unknown;
  }[];
  const row = (id: string, field: string) => overlay.find((r) => r.category === 'feats' && r.id === id && r.field === field);

  it('every field this pass wrote is in the overlay, not only in core.json', () => {
    // core.json is rebuilt by `npm run data`; effect-backfill.json is the only overlay that survives.
    expect(row('automaton-armament', 'enhancement')?.value).toEqual({ strikeDieStep: 1 });
    expect(row('arcane-communication', 'senses')?.value).toEqual([{ name: 'touch-telepathy', range: 0 }]);
    expect(row('arcane-communication', 'enhancement')).toBeTruthy();
    expect(row('automaton-lore', 'enhancement')?.value).toEqual({ choiceIds: ['enhancement-rank'] });
    expect(row('automaton-lore', 'effectChoices')).toBeTruthy();
    expect(row('lesser-augmentation', 'enhancementPicker')?.value).toEqual({ choiceIds: ['enhancement'] });
    expect(row('greater-augmentation', 'enhancementPicker')?.value).toEqual({ choiceIds: ['enhancement'] });
  });

  it("Arcane Eye's spurious flat grant is DELETED, which the overlay writes as null", () => {
    expect(row('arcane-eye', 'innateSpells')?.value).toBeNull();
    expect(db.feats['arcane-eye'].innateSpells).toBeUndefined();
  });

  it("Automaton Lore's description matches the edition the record claims", () => {
    // Our record is aonId feat-3093, edition remaster, and its ast carries the remaster sentence.
    // The shipped `description` was a HYBRID of neither printing: it kept the legacy master clause
    // without the legacy's "as well as Automaton Lore". Both printings were read from the mirror.
    const d = db.feats['automaton-lore'].description;
    expect(d).toContain('**Enhancement** Increase your proficiency rank in your choice of either Arcana or Crafting to expert.');
    expect(d).not.toContain('increase your rank to master instead');
    // and the overlay row agrees with what core-descriptions.json actually ships
    expect(row('automaton-lore', 'description')?.value).toBe(d);
  });
});
