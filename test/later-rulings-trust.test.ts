import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { applyPlayState, initialPlay } from '../src/rules/play';
import { cantripsOverOf, ownPlacesBeside, pickerSpellOptions } from '../src/rules/spellOptions';
import { enabledBookSet } from '../src/rules/sources';
import type { Character, ContentDatabase, SpellcastingEntry } from '../src/rules/types';

/**
 * PACKAGE K (2026-10-15) — two rulings given AFTER the 2026-09-10 desk pass reach the sheet with the trust
 * gate ON, which is how every player sees the app.
 *
 * The trust gate switches off every record mechanic Wanderer's Guide does not encode unless
 * scripts/data/trust-approvals.json approves it, and until package K only a 2026-09-10 desk number could
 * carry an approval. So two rulings shipped dark:
 *
 *   · #174 Adapted Cantrip on a repertoire caster — his "Follow print". Print (feat-4474): *"If you have a
 *     spell repertoire, replace one of your cantrips known with the chosen spell."* The record's
 *     spellSlotBonus { cantrips: -1 } was on the OFF list, so with the gate on a level-1 sorcerer knew SIX
 *     cantrips (four picks, the bloodline's, and the adapted one) where print says five.
 *   · #175 Basic Cleric Spellcasting — his "start K" after reading feat-5067: *"You can prepare your
 *     deity's spells in your spell slots of the appropriate rank from the cleric archetype."* Not built at
 *     all before; built as one overlay row (spellListAdditions from the deity into the archetype's entry),
 *     which WG does not encode (it gives only giveSpellSlot), so it would have shipped dark too.
 *
 * Each leg reads the GATED content, and each is mutation-proved in memory: the shipped OFF list is
 * planted back on a clone of the gated record, and the assertion reads the old number. Fixtures are
 * synthetic ("TEST …"), never an owner's character.
 */
const db = content();
const gated = content({ trustGate: true });
const CORE = enabledBookSet(undefined);
const ledger = JSON.parse(readFileSync('src/data/trust-ledger.json', 'utf8')) as { records: Record<string, string[]> };

const pc = (d: ContentDatabase, classId: string, level: number, over: Partial<BuildState> = {}): BuildState =>
  ({
    ...emptyBuild(),
    name: 'TEST later rulings',
    level,
    classId,
    subclassId: d.classes[classId]?.subclass?.options[0]?.id ?? null,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: Object.keys(d.backgrounds)[0],
    keyAbility: d.classes[classId]?.keyAbility?.[0] ?? null,
    ...over,
  }) as BuildState;
const entryOf = (ch: Character, id: string): SpellcastingEntry => ch.spellcasting.find((e) => e.id === id)!;

/** Run `fn` against `d` with one record swapped for `rec`, putting the shipped record back afterwards. */
function withRecord<T>(d: ContentDatabase, bucket: 'feats', id: string, rec: unknown, fn: () => T): T {
  const saved = d[bucket][id];
  (d[bucket] as Record<string, unknown>)[id] = rec;
  try {
    return fn();
  } finally {
    d[bucket][id] = saved;
  }
}

describe('#174 · Adapted Cantrip on a sorcerer, trust gate on: the adapted cantrip replaces one known cantrip', () => {
  /** A 1st-level sorcerer with Adapted Cantrip (electric arc) and every place the builder offers filled. */
  const sorcerer = (d: ContentDatabase) => {
    const plain = pc(d, 'sorcerer', 1, { keyAbility: 'cha' });
    const probe = entryOf(buildCharacter(plain, d), 'sorcerer-casting');
    const gift = probe.grantedCantrips ?? [];
    const adapted = { ...plain, featPicks: { '1:ancestry:0': 'adapted-cantrip' }, featChoices: { '1:ancestry:0': 'electric-arc' } } as BuildState;
    const cap = entryOf(buildCharacter(adapted, d), 'sorcerer-casting').cantripCap!;
    const own = Object.values(d.spells)
      .filter((s) => s.rank === 0 && s.rarity === 'common' && CORE.has(s.source?.book ?? '') && s.traditions?.includes(probe.tradition) && !s.traits?.includes('focus'))
      .map((s) => s.id)
      .sort()
      .filter((id) => !gift.includes(id) && id !== 'electric-arc')
      .slice(0, ownPlacesBeside(probe, 0, cap, []));
    const ch = buildCharacter({ ...adapted, cantrips: own } as BuildState, d);
    return { plainCap: probe.cantripCap!, cap, known: entryOf(ch, 'sorcerer-casting').cantrips };
  };

  it('the shipped ledger leaves Adapted Cantrip on, and the gated record keeps its -1', () => {
    expect(ledger.records['feats/adapted-cantrip'], 'feats/adapted-cantrip is on no OFF list').toBeUndefined();
    expect(gated.feats['adapted-cantrip'].spellSlotBonus).toEqual({ cantrips: -1 });
  });

  // mutation-proof
  it('a level-1 sorcerer knows 5 cantrips, the adapted one among them — gate on, as in the app', () => {
    const s = sorcerer(gated);
    expect(s.plainCap, 'fixture: a level-1 sorcerer knows five without the feat').toBe(5);
    expect(s.cap, 'the feat takes one place').toBe(4);
    expect(s.known, 'electric arc is known').toContain('electric-arc');
    expect(s.known, 'five cantrips known in all').toHaveLength(5);
    // …and the ungated engine agrees: the gate no longer changes the answer.
    expect(sorcerer(db).known).toHaveLength(5);
    // The planted bad case: the gate stripping the -1, as it did before #174's approval.
    const stripped = { ...gated.feats['adapted-cantrip'] };
    delete stripped.spellSlotBonus;
    const old = withRecord(gated, 'feats', 'adapted-cantrip', stripped, () => sorcerer(gated));
    expect(old.known, 'the old gated sorcerer knew six').toHaveLength(6);
  });

  /*
   * AN OLD SAVE KEEPS EVERY PICK. The released v0.1.43 shipped the -1 OFF under the gate, so its builder let
   * a human bard pick five cantrips beside Adapted Cantrip, and a sorcerer five beside its bloodline gift.
   * With the -1 on, the stored list was sliced to the new allowance: the last pick vanished from the sheet
   * and nothing said so (the independent check of package K, measured: a bard lost its fifth pick with the
   * over marker at 0). Like a save made before Dual Class routed the bonuses, every pick is DRAWN and the
   * extra is REPORTED (`cantripCapWas`, `cantripsOverOf`) for the player to remove in the builder — the app
   * never chooses which of their cantrips goes.
   */
  it('an old save with a pick past the new allowance keeps it on the sheet and is told it is over', () => {
    for (const cls of ['bard', 'sorcerer'] as const) {
      const plain = pc(gated, cls, 1, { keyAbility: 'cha' });
      const probe = entryOf(buildCharacter(plain, gated), `${cls}-casting`);
      const gift = probe.grantedCantrips ?? [];
      const five = Object.values(gated.spells)
        .filter((s) => s.rank === 0 && s.rarity === 'common' && CORE.has(s.source?.book ?? '') && s.traditions?.includes(probe.tradition) && !s.traits?.includes('focus'))
        .map((s) => s.id)
        .sort()
        .filter((id) => !gift.includes(id) && id !== 'electric-arc')
        .slice(0, 5);
      const b = { ...plain, featPicks: { '1:ancestry:0': 'adapted-cantrip' }, featChoices: { '1:ancestry:0': 'electric-arc' }, cantrips: five } as BuildState;
      const e = entryOf(buildCharacter(b, gated), `${cls}-casting`);
      expect(e.cantripCap, `${cls}: the allowance is one lower`).toBe((probe.cantripCap ?? 0) - 1);
      expect(five.filter((id) => !e.cantrips.includes(id)), `${cls}: no stored pick is missing from the sheet`).toEqual([]);
      // The bard's own places are the allowance (4); the sorcerer's are the allowance less its gift (3).
      expect(cantripsOverOf(e), `${cls}: the extra picks are reported`).toBe(5 - ((e.cantripCap ?? 0) - gift.length));
    }
  });

  it('a prepared caster still keeps every cantrip opening (print: "in addition to your other options")', () => {
    const plain = pc(gated, 'cleric', 1, { keyAbility: 'wis', subclassId: 'cloistered-cleric' });
    const adapted = { ...plain, featPicks: { '1:ancestry:0': 'adapted-cantrip' }, featChoices: { '1:ancestry:0': 'electric-arc' } } as BuildState;
    expect(entryOf(buildCharacter(adapted, gated), 'cleric-casting').cantripCap).toBe(entryOf(buildCharacter(plain, gated), 'cleric-casting').cantripCap);
  });
});

describe("#175 · Basic Cleric Spellcasting, trust gate on: the deity's spells in the archetype's slots", () => {
  /** A fighter with Cleric Dedication (2nd) and Basic Cleric Spellcasting (4th), following Iomedae. */
  const fighter = (d: ContentDatabase, level: number, basic = true) =>
    buildCharacter(
      pc(d, 'fighter', level, {
        keyAbility: 'str',
        subclassId: null,
        deityId: 'iomedae',
        featPicks: { '2:class:0': 'cleric-dedication', ...(basic ? { '4:class:1': 'basic-cleric-spellcasting' } : {}) },
      }),
      d,
    );
  const ENTRY = 'cleric-dedication-casting';
  const offered = (ch: Character, d: ContentDatabase, rank: number) => {
    const sheet = applyPlayState(ch, initialPlay(ch, d), d);
    return pickerSpellOptions({ character: sheet, entry: entryOf(sheet, ENTRY), content: d }, rank, undefined, CORE).map((s) => s.id);
  };
  /** The ranks the archetype has prepared slots of (a prepared entry keeps its slots under `prepared`). */
  const ranksOf = (ch: Character) => Object.keys(entryOf(ch, ENTRY).prepared ?? {}).map(Number).filter((r) => r > 0).sort((a, b) => a - b);

  it("fixture: Iomedae's three spells are on no divine list — sure strike 1, enlarge 2, fire shield 4", () => {
    expect(gated.deities.iomedae.spells).toEqual(['sure-strike', 'enlarge', 'fire-shield']);
    for (const [id, rank] of [['sure-strike', 1], ['enlarge', 2], ['fire-shield', 4]] as const) {
      expect(gated.spells[id].rank, id).toBe(rank);
      expect(gated.spells[id].traditions, id).not.toContain('divine');
    }
  });

  it('the shipped ledger leaves the row on, and the gated record carries it', () => {
    expect(ledger.records['feats/basic-cleric-spellcasting'], 'on no OFF list').toBeUndefined();
    expect(gated.feats['basic-cleric-spellcasting'].spellListAdditions).toEqual([{ from: 'deity', as: 'list', entryId: ENTRY }]);
  });

  // mutation-proof
  it('at 4th level the rank-1 slot offers sure strike, and nothing of a rank the archetype has no slot for', () => {
    const ch = fighter(gated, 4);
    expect(ranksOf(ch), 'fixture: one rank-1 slot at 4th').toEqual([1]);
    expect(ch.spellListAdditions?.[ENTRY]).toEqual(expect.arrayContaining(['sure-strike', 'enlarge', 'fire-shield']));
    const r1 = offered(ch, gated, 1);
    expect(r1, 'the deity spell of rank 1').toContain('sure-strike');
    expect(r1, 'a rank-2 spell is not offered in a rank-1 slot').not.toContain('enlarge');
    expect(r1).not.toContain('fire-shield');
    // The planted bad case: the gate stripping the row, as it would without #175's approval.
    const stripped = { ...gated.feats['basic-cleric-spellcasting'] };
    delete stripped.spellListAdditions;
    const old = withRecord(gated, 'feats', 'basic-cleric-spellcasting', stripped, () => offered(fighter(gated, 4), gated, 1));
    expect(old, 'without the row the deity spell is not offered').not.toContain('sure-strike');
  });

  it('at 6th level the new rank-2 slot offers enlarge; fire shield waits for a rank-4 slot', () => {
    const ch = fighter(gated, 6);
    expect(ranksOf(ch), 'fixture: rank-1 and rank-2 slots at 6th').toEqual([1, 2]);
    expect(offered(ch, gated, 2)).toContain('enlarge');
    expect(offered(ch, gated, 2)).not.toContain('fire-shield');
  });

  it('Cleric Dedication alone adds nothing — the feat is what adds the spells', () => {
    const ch = fighter(gated, 4, false);
    expect(ch.spellListAdditions?.[ENTRY] ?? []).not.toContain('sure-strike');
  });
});
