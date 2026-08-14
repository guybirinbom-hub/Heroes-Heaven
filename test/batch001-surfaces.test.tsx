// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { renderText } from './_render';
import { MainTab } from '../src/sheet/MainTab';
import { ActionGlyph } from '../src/sheet/widgets';
import { featEntries } from '../src/sheet/FeatsTab';
import { deriveStrikes, derivePerception, deriveSave } from '../src/rules/derive';
import { recordMarkersFor, spellNotesFor } from '../src/rules/explain';
import { FEAT_SITUATIONAL } from '../src/rules/situationalBonuses';
import { skillActionsFor } from '../src/rules/skillActions';
import { eligibleFeatsForSlot } from '../src/rules/featSlots';
import { buildCharacter, emptyBuild } from '../src/rules/build';
import { audit } from '../scripts/scan-duplicate-feats.mjs';
import type { ActionCost, Character } from '../src/rules/types';

/**
 * Batch-001, cluster "surfaces that do not exist".
 *
 * Every case here is a clause whose value the app could compute and had nowhere to PUT: a mode field
 * that did not exist, an action-cost type nothing rendered, a marker surface with only two targets, a
 * skill-action row, and a picker offering one feat twice.
 *
 * ⚠ `build()`'s third argument is a Partial<BuildState>, NOT a Partial<Character> — passing
 * `{ feats: [...] }` there is silently ignored and the character comes back with none. Overriding the
 * built CHARACTER is the shipped pattern (test/rulings-dfgh.test.ts `withSource`), and it is what
 * `withFeats` below does.
 */
const c = () => content();
const noop = () => undefined;
const withFeats = (ch: Character, ...featIds: string[]): Character => ({
  ...ch,
  feats: featIds.map((featId) => ({ featId, level: 1, source: 'class' as const })),
});

describe('Agile Shield Grip — a weapon rider that can be switched off', () => {
  const fighter = () =>
    build('fighter', 5, {
      inventory: [
        { itemId: 'shield-boss', qty: 1, equipped: true },
        { itemId: 'longsword', qty: 1, equipped: true },
      ],
    });
  const boss = (ch: Character) => deriveStrikes(ch, c()).find((s) => s.name === 'Shield Boss')!;
  const sword = (ch: Character) => deriveStrikes(ch, c()).find((s) => s.name === 'Longsword')!;

  it('drops the shield boss to 1d4 and gives it agile, only while the mode is on', () => {
    const base = withFeats(fighter(), 'agile-shield-grip');
    // BASELINE — this is what shipped, and it is what the mode has to move.
    // ⚠ `Strike.damage` is a STRING ("1d6 B"); there is no `.die`. A `damage.die` assertion is
    // `undefined === undefined` and passes against a rider that never fired.
    expect(boss(base).damage).toMatch(/^1d6/);
    expect(boss(base).traits).not.toContain('agile');
    expect(boss(base).mapStep).toBe(5);

    const on = { ...base, activeModes: [c().modes['agile-shield-grip']] };
    expect(boss(on).damage).toMatch(/^1d4/);
    expect(boss(on).traits).toContain('agile');
    // The STRIKE's own step, not `mapStepFor(c, db, strike.traits)`: that helper returns 4 for any
    // trait list containing `agile`, so it would pass even if the rider never ran.
    expect(boss(on).mapStep).toBe(4);
    expect(boss(on).attack[0] - boss(on).attack[1]).toBe(4);
  });

  it('leaves every other weapon alone — the match filter is the whole danger here', () => {
    const on = { ...withFeats(fighter(), 'agile-shield-grip'), activeModes: [c().modes['agile-shield-grip']] };
    expect(sword(on).damage).toMatch(/^1d8/);
    expect(sword(on).traits).not.toContain('agile');
    expect(sword(on).mapStep).toBe(5);
  });

  it('the MODE is the only carrier — authoring the rider on the feat would make it unconditional', () => {
    // The specific wrong fix. The feat's last printed sentence is a switch ("You can use Agile Shield
    // Grip again to switch to a normal grip"), so a permanent rider would be a different rule.
    expect((c().feats['agile-shield-grip'] as { weaponTraits?: unknown }).weaponTraits).toBeUndefined();
    expect(c().modes['agile-shield-grip'].weaponTraits).toBeTruthy();
  });
});

describe('Bon Mot backfired — the critical failure the player could only read about', () => {
  it('actually moves Perception and Will by 2, and hands them back', () => {
    const base = withFeats(build('bard', 3), 'bon-mot');
    const p0 = derivePerception(base, c()).modifier;
    const w0 = deriveSave(base, 'will', c()).modifier;
    const f0 = deriveSave(base, 'fortitude', c()).modifier;

    const on = { ...base, activeModes: [c().modes['bon-mot-backfired']] };
    expect(derivePerception(on, c()).modifier).toBe(p0 - 2);
    expect(deriveSave(on, 'will', c()).modifier).toBe(w0 - 2);
    // Fortitude is the control: the penalty is Perception + Will, and a mode that moved everything
    // would satisfy the two assertions above.
    expect(deriveSave(on, 'fortitude', c()).modifier).toBe(f0);

    const off = { ...on, activeModes: [] };
    expect(derivePerception(off, c()).modifier).toBe(p0);
    expect(deriveSave(off, 'will', c()).modifier).toBe(w0);
  });

  it('the penalty is a STATUS penalty', () => {
    expect(c().modes['bon-mot-backfired'].modifiers).toEqual([
      { value: -2, type: 'status', target: 'perception' },
      { value: -2, type: 'status', target: 'save', detail: 'will' },
    ]);
  });

  it("keeps Bon Mot's own star — R2 case (c): the penalty outlives the action", () => {
    // "the bonus outlives the action — a duration … 'for 1 minute' … → star stands." The mode and the
    // star are not alternatives here, and a situational entry never folds into a total (Ruling B).
    expect(FEAT_SITUATIONAL['bon-mot']).toBeTruthy();
  });
});

describe('Armor in Earth — every printed statistic, where its two siblings already have theirs', () => {
  it('exists, is gated on the feat, and carries the whole stat block', () => {
    const m = c().modes['armor-in-earth'];
    expect(m).toBeTruthy();
    expect(m.feats).toEqual(['armor-in-earth']);
    // AoN feat-4221: "AC Bonus +4; Dex Cap +1; Check Penalty –2; Speed Penalty –10 feet; Strength +3;
    // Bulk 1; Group plate" and, at 3rd, "AC Bonus becomes +5, and it gains the bulwark armor trait".
    for (const printed of ['+4', '+1', '-2', '-10 feet', '+3', 'plate', '+5', 'bulwark']) {
      expect(m.note).toContain(printed);
    }
  });

  it('matches the two identically-shaped siblings that were authored and it was not', () => {
    for (const id of ['armor-in-earth', 'metal-carapace', 'hardwood-armor']) {
      expect(c().modes[id].duration).toBe('10 minutes (Dismissible; using the impulse again ends the old one)');
      expect(c().modes[id].note).toContain('The app cannot swap armor statistics automatically — unequip your worn armor');
    }
  });
});

describe('Acupuncturist — a downtime Medicine activity, feat-gated', () => {
  const names = (rank: 'untrained' | 'trained', has: (n: string) => boolean) =>
    skillActionsFor('medicine', rank, has).map((a) => a.name);

  it('appears for a character with the feat and for nobody else', () => {
    expect(names('trained', (n) => n === 'Acupuncturist')).toContain('Acupuncturist');
    expect(names('trained', () => false)).not.toContain('Acupuncturist');
  });

  it('is gated on being trained in Medicine', () => {
    expect(names('untrained', () => true)).not.toContain('Acupuncturist');
  });

  it("keeps the ALLY's numbers in prose and in no modifier (Ruling F)", () => {
    const row = skillActionsFor('medicine', 'trained', (n) => n === 'Acupuncturist').find((a) => a.name === 'Acupuncturist')!;
    expect(row.costText).toBe('downtime');
    expect(row.desc).toContain('+2 circumstance bonus');
    expect(row.desc).toContain('-1 circumstance penalty');
    // …and no situational star, which would put an ally-facing bonus on THIS character's sheet.
    expect(FEAT_SITUATIONAL['acupuncturist']).toBeUndefined();
  });
});

describe("Ancestral Blood Magic — Principle C, on a record that is not an action or a condition", () => {
  const sorcerer = () => build('sorcerer', 3);

  it("marks the Bloodline feature, and only for a sorcerer who has the feat", () => {
    const withIt = withFeats(sorcerer(), 'ancestral-blood-magic');
    const marks = recordMarkersFor(withIt, c(), 'feature', 'bloodline');
    expect(marks).toHaveLength(1);
    expect(marks[0].sourceId).toBe('ancestral-blood-magic');
    expect(marks[0].note).toContain('heritage or an ancestry feat');
    // Ungated, this would tell every sorcerer their blood magic is wider than it is.
    expect(recordMarkersFor(sorcerer(), c(), 'feature', 'bloodline')).toEqual([]);
  });

  it('does not leak onto the action or condition surfaces', () => {
    const withIt = withFeats(sorcerer(), 'ancestral-blood-magic');
    expect(recordMarkersFor(withIt, c(), 'action', 'bloodline')).toEqual([]);
    expect(recordMarkersFor(withIt, c(), 'condition', 'bloodline')).toEqual([]);
  });

  it("reaches the Bloodline entry's description on the Feats tab, named once", () => {
    const withIt = withFeats(sorcerer(), 'ancestral-blood-magic');
    const entry = featEntries(withIt, c()).find((e) => e.featureId === 'bloodline')!;
    expect(entry).toBeTruthy();
    expect(entry.description).toContain('Ancestral Blood Magic');
    expect(entry.description).toContain('heritage or an ancestry feat');
    // ⚠ All three mark renderers prefix the record's name themselves. 40 of the shipped marks also
    // open with it, which printed "Weapon Supremacy: Weapon Supremacy: …"; this line is the guard.
    expect(entry.description.match(/Ancestral Blood Magic/g)).toHaveLength(1);

    const without = featEntries(sorcerer(), c()).find((e) => e.featureId === 'bloodline')!;
    expect(without.description).not.toContain('Ancestral Blood Magic');
  });

  /**
   * The prefix guard, on a mark that actually carries the redundant name.
   *
   * `RECORD_MARKERS['ancestral-blood-magic']` is authored WITHOUT its own name, so it cannot tell
   * whether this renderer strips one — and 40 of the 119 shipped marks do carry it. Injected through
   * `grantMarkers`, the same gated `extra` channel `recordMarkersFor` already merges, which also
   * proves the new `'feature'` surface reads that channel and not only the static table.
   */
  it('strips a mark note that repeats its own record name, on the feature surface too', () => {
    const ch: Character = {
      ...withFeats(sorcerer(), 'toughness'),
      grantMarkers: { toughness: [{ on: 'feature', id: 'bloodline', note: 'Toughness: your maximum HP increases.' }] },
    };
    const entry = featEntries(ch, c()).find((e) => e.featureId === 'bloodline')!;
    expect(entry.description).toContain('<strong>Toughness:</strong> your maximum HP increases.');
    expect(entry.description.match(/Toughness/g)).toHaveLength(1);
  });
});

describe('Ancestral Blood Magic — the SECOND half: a mark on each qualifying spell (Q8 / N2)', () => {
  const bg = () => Object.keys(c().backgrounds)[0];
  const dragonSorc = (picks: Record<string, string>) =>
    buildCharacter(
      {
        ...emptyBuild(),
        name: 't',
        level: 5,
        classId: 'sorcerer',
        ancestryId: 'dragonblood',
        backgroundId: bg(),
        keyAbility: 'cha',
        subclassId: c().classes.sorcerer.subclass?.options[0]?.id ?? null,
        heritageId: Object.values(c().heritages).find((h) => h.ancestryId === 'dragonblood')?.id ?? null,
        featPicks: picks,
      },
      c(),
    );

  it("marks a non-cantrip spell the character gained from an ancestry feat", () => {
    const withIt = dragonSorc({ '1:ancestry:0': 'dragon-prince', '1:class:0': 'ancestral-blood-magic' });
    const notes = spellNotesFor(withIt, 'dragon-breath');
    expect(notes.map((n) => n.from)).toContain('Ancestral Blood Magic');
    expect(notes.find((n) => n.from === 'Ancestral Blood Magic')!.note).toContain('blood magic');
  });

  it('marks nothing without the feat — the set is per-character, not per-spell', () => {
    const without = dragonSorc({ '1:ancestry:0': 'dragon-prince' });
    expect(spellNotesFor(without, 'dragon-breath').map((n) => n.from)).not.toContain('Ancestral Blood Magic');
    // Dragon Prince's own note is still there, so this is not "no notes at all".
    expect(spellNotesFor(without, 'dragon-breath').length).toBeGreaterThan(0);
  });

  it('does NOT mark a CANTRIP from the same kind of source — the clause says non-cantrip', () => {
    const elf = buildCharacter(
      {
        ...emptyBuild(),
        name: 't',
        level: 5,
        classId: 'sorcerer',
        ancestryId: 'elf',
        backgroundId: bg(),
        keyAbility: 'cha',
        subclassId: c().classes.sorcerer.subclass?.options[0]?.id ?? null,
        featPicks: { '1:ancestry:0': 'elemental-wrath', '1:class:0': 'ancestral-blood-magic' },
      },
      c(),
    );
    expect(elf.feats.map((f) => f.featId)).toContain('elemental-wrath');
    expect(spellNotesFor(elf, 'acid-splash').map((n) => n.from)).not.toContain('Ancestral Blood Magic');
  });
});

describe('Apparition Sense — the duration action cost, which had zero users and no renderer', () => {
  it('the activity is its own action record, pointed at by the feat', () => {
    expect(c().actions['apparition-sense'].actionCost).toEqual({ type: 'duration', text: '10 minutes' });
    expect(c().feats['apparition-sense'].grantsActions).toEqual(['apparition-sense']);
  });

  it("the standing capability is the feat's own note, and the procedure is not duplicated", () => {
    const feat = c().feats['apparition-sense'];
    expect(feat.note).toContain('speak through you');
    // MEASURED: of 186 grantsActions pairs where both descriptions exist, the granter repeats the
    // action's text in 2. `classFeatures/rage` is the convention — "You gain the Rage action, which…".
    expect(feat.description).not.toContain('As an activity that takes 10 minutes');
    expect(feat.description).toContain('You also gain the Apparition Sense activity');
    expect(c().actions['apparition-sense'].description).toContain('As an activity that takes 10 minutes');
  });

  it('ActionGlyph draws the printed words — before this the cost slot came out EMPTY', () => {
    expect(renderText(<ActionGlyph cost={{ type: 'duration', text: '10 minutes' }} />)).toContain('10 minutes');
  });

  it("reaches the Main tab's Feat actions list", () => {
    const ch = withFeats(build('fighter', 5), 'apparition-sense');
    const text = renderText(<MainTab character={ch} content={c()} onPlay={noop} />, ['Actions']);
    expect(text).toContain('Apparition Sense');
    expect(text).toContain('10 minutes');
  });

  it("does not appear for a character who doesn't have the feat", () => {
    const text = renderText(<MainTab character={build('fighter', 5)} content={c()} onPlay={noop} />, ['Actions']);
    expect(text).not.toContain('Apparition Sense');
  });

  /**
   * THE SHAPE, not the record. `ActionCost` is a union and `ActionGlyph`'s `default: return null` is
   * silent — a record authored with a type nothing renders is invisible with no error anywhere. This
   * is the guard that would have caught `duration` shipping dead, and it fails the next time a type
   * reaches the data without a renderer.
   */
  it('every actionCost type in the shipped data has a renderer or is deliberately passive', () => {
    const RENDERED = new Set(['actions', 'free', 'reaction', 'variable', 'duration']);
    const found = new Set<string>();
    for (const bucket of Object.values(c() as unknown as Record<string, Record<string, { actionCost?: ActionCost }>>)) {
      if (!bucket || typeof bucket !== 'object') continue;
      for (const rec of Object.values(bucket)) {
        const t = (rec as { actionCost?: ActionCost })?.actionCost?.type;
        if (typeof t === 'string') found.add(t);
      }
    }
    expect([...found].sort()).toEqual([...found].filter((t) => t === 'passive' || RENDERED.has(t)).sort());
    // …and `duration` really is in the data now, so the assertion above is not vacuous.
    expect(found.has('duration')).toBe(true);
  });
});

describe('Animal Empathy — one feat, one row in the picker', () => {
  it("a druid's 1st-level class picker lists Animal Empathy once", () => {
    const rows = eligibleFeatsForSlot(
      { classId: 'druid', ancestryId: 'human', level: 1, featPicks: {}, featChoices: {} } as never,
      c(),
      { level: 1, category: 'class', idx: 0 },
    ).filter((f) => /^Animal Empathy/.test(f.name));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('animal-empathy');
  });

  it('hides, never deletes — a character who already picked the twin still resolves it', () => {
    expect(c().feats['animal-empathy-druid']).toBeTruthy();
    expect(c().duplicateIds?.has('animal-empathy-druid')).toBe(true);
  });

  it("repairs the twin's description, which opened with an unstripped bibliographic header", () => {
    const d = c().feats['animal-empathy-druid'].description;
    expect(d).not.toContain('Source Player Core pg. 127');
    expect(d).not.toContain('Archetypes Beastmaster');
    expect(d.startsWith('You have a connection to the creatures of the natural world')).toBe(true);
  });
});

describe('the SHAPE behind Animal Empathy — a ratchet on every picker that lists one feat twice', () => {
  /**
   * `npm run scan:dupe-feats`. The audit named one record; the scanner measures the family by the
   * OUTCOME — running the app's own `eligibleFeatsForSlot` over every (category × class/ancestry)
   * combination and asking whether two records for one AoN document are offered together.
   *
   * The number may only go DOWN. It is not zero and cannot be swept to zero mechanically: the scanner's
   * own header records the two measurements that kill a blanket rule (the AoN mirror carries the
   * misspelling in four groups; a parenthetical twin can be a genuinely different document). Each
   * remaining group has to be read and settled into NEAR_DUPLICATE_IDS with its evidence.
   */
  const CEILING = 39;

  it(`no more than ${CEILING} groups are still offered twice`, () => {
    const { groups } = audit();
    expect(groups.length).toBeLessThanOrEqual(CEILING);
  });

  it('the group the audit named is settled, and the two that were never defects are untouched', () => {
    const { groups } = audit();
    const ids = new Set(groups.flatMap((g) => g.ids));
    // Fixed by this cluster.
    expect(ids.has('animal-empathy')).toBe(false);
    expect(ids.has('animal-empathy-druid')).toBe(false);
    // …and the controls: same-aonId groups that are correctly scoped apart and must NOT be reported.
    // A detector matching the CONDITION ("two records share an aonId") flags both of these.
    expect(ids.has('tusks-orc')).toBe(false);
    expect(ids.has('counterspell-spontaneous')).toBe(false);
  });
});

describe('speaking with animals — the clause reaches the skill the player looks it up on', () => {
  it('Animal Elocutionist carries BOTH its clauses, not just the +1', () => {
    const rows = FEAT_SITUATIONAL['animal-elocutionist'];
    expect(rows).toHaveLength(2);
    expect(rows[0].bonus).toBe('+1 circumstance');
    expect(rows[1].bonus).toContain('use Diplomacy with animals');
  });

  it('Animal Empathy stars Diplomacy and grants NO modifier', () => {
    const rows = FEAT_SITUATIONAL['animal-empathy'];
    expect(rows).toHaveLength(1);
    expect(rows[0].targets).toEqual([{ kind: 'skill', detail: 'diplomacy' }]);
    expect(rows[0].when).toContain('rudimentary');
    // The feat grants a USE, not a bonus. The test says so, so nobody later "fixes" a number in.
    expect(rows[0].bonus).not.toMatch(/[+−-]\s*\d/);
    expect(rows[0].bonus).toContain('(no modifier)');
  });

  it('…and the HIDDEN twin gets no star of its own', () => {
    // test/triage-lane-close.test.ts refuses a situational entry on a record no picker offers, and it
    // is right: only a character saved before the dedupe could ever see it. Authoring one here was the
    // tempting symmetry and it would have shipped a dead star.
    expect(FEAT_SITUATIONAL['animal-empathy-druid']).toBeUndefined();
  });

  it("keeps every `when` inside Ruling H's one-line cap", () => {
    for (const id of ['animal-elocutionist', 'animal-empathy']) {
      for (const row of FEAT_SITUATIONAL[id]) expect(row.when.length).toBeLessThanOrEqual(120);
    }
  });
});
