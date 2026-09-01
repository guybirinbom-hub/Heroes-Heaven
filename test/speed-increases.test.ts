import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { deriveSpeeds } from '../src/rules/derive';
import { explainStat } from '../src/rules/explain';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import type { Character } from '../src/rules/types';
import { normalizeCharacter } from '../src/rules/normalize';

const c = content();
const build = (over: Partial<BuildState>): BuildState => ({ ...emptyBuild(), ...over });

/**
 * SPEED INCREASES.
 *
 * `speeds.land` means "raise the base TO this" — right for "your land Speed becomes 10 feet", wrong
 * for "your Speed increases by 5 feet". Fourteen records stored an increase that way, so a +5 could
 * never beat a 25-foot base and Fleet, Nimble Elf, Furious Footfalls and Blessed Swiftness were all
 * completely inert. The additive field is `landSpeedBonus`.
 */

const human = (featIds: string[]): Character =>
  normalizeCharacter({
    id: 'sp', name: 'Sp', level: 5, classId: 'fighter', keyAbility: 'str', ancestryId: 'human',
    abilities: { str: 16, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
    feats: featIds.map((featId) => ({ featId })),
  });

describe('speed increases actually raise your Speed', () => {
  const base = deriveSpeeds(human([]), c).land!;

  it('a human starts at 25 feet', () => expect(base).toBe(25));

  it('Fleet adds 5 feet', () => {
    expect(deriveSpeeds(human(['fleet']), c).land).toBe(base + 5);
  });

  it("Scout's Speed adds 10", () => {
    expect(deriveSpeeds(human(['scouts-speed']), c).land).toBe(base + 10);
  });

  it('two separate increases both count', () => {
    expect(deriveSpeeds(human(['fleet', 'scouts-speed']), c).land).toBe(base + 15);
  });

  it('no increase stayed in the raise-to field, where it could never fire', () => {
    // The exact defect: a record whose text says "increases by N" but stores speeds.land = N.
    const bad: string[] = [];
    for (const col of ['classFeatures', 'feats', 'heritages'] as const) {
      for (const [id, r] of Object.entries(c[col] as Record<string, { speeds?: { land?: unknown }; description?: string }>)) {
        const land = r.speeds?.land;
        if (typeof land !== 'number' || land >= 15) continue;
        const text = (r.description ?? '').replace(/<[^>]+>/g, ' ');
        if (/Speed increases by|-foot (status|circumstance|item)? ?bonus to (your )?Speed/i.test(text)) bad.push(`${col}/${id}`);
      }
    }
    /*
     * monk-moves USED to be listed here, with the note "its +10 applies only while unarmored, and the
     * unconditional field would over-grant" — an acknowledgement that it WAS wrong, kept because no
     * lane could say "unarmored". It now lives in `speedsIf.unarmored` and is evaluated, so a monk in
     * plate gets nothing; see test/conditional-speeds.test.ts. tillers-drive stays: it REPLACES another
     * feat's bonus rather than adding to the base, which is a different shape from this defect.
     */
    expect(bad.sort()).toEqual(['feats/tillers-drive']);
  });

  it('a real "becomes N feet" record still raises to N', () => {
    // Strong Tail is for low-Speed ancestries — merfolk walk at 5 feet.
    const merfolk = normalizeCharacter({
      id: 'm', name: 'M', level: 3, classId: 'fighter', keyAbility: 'str', ancestryId: 'merfolk',
      abilities: { str: 16, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
      feats: [{ featId: 'strong-tail' }],
    });
    expect(deriveSpeeds(merfolk, c).land).toBe(15);
  });

  it('a class feature increase counts too', () => {
    const barb = (feats: string[]) =>
      buildCharacter(build({ classId: 'barbarian', subclassId: 'animal', level: 3, ancestryId: 'human', feats: {} as never }), c);
    // Furious Footfalls is an auto-granted barbarian feature, so it needs no feat pick.
    const speed = deriveSpeeds(barb([]), c).land ?? 0;
    expect(speed, 'barbarian Furious Footfalls +5').toBe(30);
  });
});

/**
 * The Speed popup must AGREE with the Speed on the sheet.
 *
 * `explain.ts` treated `speeds.land` as raise-to while `deriveSpeeds` added it, so a +5 from Fleet
 * was in the total and missing from the parts — the breakdown listed 25 under a heading that said 30.
 */
describe('the Speed breakdown sums to the Speed', () => {
  const sum = (ch: Character) => {
    const b = explainStat(ch, c, { kind: 'speed' });
    const total = b.parts.reduce((n, p) => n + p.value, 0);
    return { total, shown: Number(String(b.totalText).replace(/[^\d-]/g, '')) };
  };

  for (const feats of [[], ['fleet'], ['scouts-speed'], ['fleet', 'scouts-speed'], ['nimble-elf']]) {
    it(`adds up with ${feats.length ? feats.join(' + ') : 'no speed feats'}`, () => {
      const { total, shown } = sum(human(feats));
      expect(total, `parts sum to ${total} but the header says ${shown}`).toBe(shown);
    });
  }

  it('adds up for a class-feature increase', () => {
    const barb = buildCharacter(build({ classId: 'barbarian', subclassId: 'animal', level: 3, ancestryId: 'human' }), c);
    const { total, shown } = sum(barb);
    expect(total).toBe(shown);
  });

  it('names the source of each increase, so the player can tell what did it', () => {
    const b = explainStat(human(['fleet']), c, { kind: 'speed' });
    expect(b.parts.some((p) => p.note === c.feats['fleet'].name)).toBe(true);
  });
});

/**
 * "You gain a climb Speed of 20 feet; IF YOU ALREADY HAVE A BASE CLIMB SPEED, IT INCREASES BY 5 FEET."
 * (Summiting Dragonblood; Aqueous Dragonblood and Like a Fish in Water print it for swim.)
 *
 * Two branches off ONE predicate, and the flat number expresses NEITHER: a non-land `speeds` grant
 * folds as max(existing, granted) (derive.ts, deriveSpeeds), so it was wrong in both directions — a
 * wetlander lizardfolk's swim 15 stayed 15 where the feat says 20, and a cecaelia merfolk's climb 10
 * jumped to 20 where the feat says 15. Six shipped heritages carry swim 15 exactly, so this was the
 * common case, not a corner.
 *
 * NO NEW LANE. `speeds` already accepts an `@actor.speed.*` FORMULA (Fast Swimmer, Timewracked
 * Dedication), and although resolveFormula has no ternary, `min(S,1)` IS the conditional: it is an
 * INDICATOR, 1 when you already have that Speed and 0 when you don't. So
 *
 *     min(S,1) * (S - 15) + 20   ==   S + 5 when S > 0,   and   20 when S == 0
 *
 * and the outer max() fold is then a no-op because S+5 > S. ⚠ The fix proposed twice before this —
 * teach `speedAdjust` provenance so a plain +5 can tell this feat's own grant from another source's
 * (scripts/audit/batch-001-applied.json) — buys nothing the arithmetic does not already do. Do not
 * build it.
 *
 * Order is safe: heritageRecords are pushed into grantSources BEFORE the feats loop, and NO ancestry
 * in core.json carries a climb or swim Speed (measured: zero) — every base swim/climb comes from a
 * heritage, so the formula always sees the character's real base and nothing else.
 */
describe('"…if you already have a base Speed of that type, it increases by 5 feet"', () => {
  const who = (ancestryId: string, heritageId: string | null, featIds: string[]): Character =>
    normalizeCharacter({
      id: 'sp', name: 'Sp', level: 5, classId: 'fighter', keyAbility: 'str', ancestryId, heritageId,
      abilities: { str: 16, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
      feats: featIds.map((featId) => ({ featId })),
    });
  const speed = (a: string, h: string | null, f: string, k: 'climb' | 'swim') => deriveSpeeds(who(a, h, [f]), c)[k] ?? 0;

  it('grants the printed Speed to someone who has none', () => {
    expect(speed('human', null, 'summiting-dragonblood', 'climb')).toBe(20);
    expect(speed('human', null, 'aqueous-dragonblood', 'swim')).toBe(15);
    expect(speed('human', null, 'like-a-fish-in-water', 'swim')).toBe(15);
  });

  it('adds 5 to a base Speed FASTER than the grant — max() used to swallow it whole', () => {
    expect(speed('awakened-animal', 'climbing-animal', 'summiting-dragonblood', 'climb')).toBe(25); // base 20
    expect(speed('elf', 'aquatic-elf', 'aqueous-dragonblood', 'swim')).toBe(35); // base 30
  });

  it('adds 5 to a base Speed SLOWER than the grant — the grant does NOT apply instead', () => {
    // Cecaelia merfolk climb 10 -> 15. The other direction of the same defect: max() said 20.
    expect(speed('merfolk', 'cecaelia-merfolk', 'summiting-dragonblood', 'climb')).toBe(15);
  });

  it('a base Speed EQUAL to the grant still gains its 5', () => {
    expect(speed('azarketi', 'mistbreath-azarketi', 'aqueous-dragonblood', 'swim')).toBe(20);
    expect(speed('lizardfolk', 'wetlander-lizardfolk', 'aqueous-dragonblood', 'swim')).toBe(20);
    expect(speed('azarketi', 'mistbreath-azarketi', 'like-a-fish-in-water', 'swim')).toBe(20);
  });

  it('every record printing the clause stores the formula, not a bare number', () => {
    // The corpus is exactly these three, measured across all 43k descriptions — and Like a Fish in
    // Water says "a swim Speed" rather than "a BASE swim Speed", which is why it went unnoticed.
    // A regeneration that reverts one to `{ swim: 15 }` fails here instead of quietly shipping max().
    const clause = /if you already have (?:a|any) (?:base )?(land|fly|swim|climb|burrow) Speed, it increases by/i;
    const found: string[] = [];
    const offenders: string[] = [];
    for (const [id, r] of Object.entries(c.feats as Record<string, { description?: string; speeds?: Record<string, unknown> }>)) {
      const m = (r.description ?? '').replace(/<[^>]+>/g, ' ').match(clause);
      if (!m) continue;
      found.push(id);
      const v = r.speeds?.[m[1].toLowerCase()];
      if (typeof v !== 'string' || !v.includes('@actor.speed.')) offenders.push(`feats/${id}`);
    }
    expect(found.sort()).toEqual(['aqueous-dragonblood', 'like-a-fish-in-water', 'summiting-dragonblood']);
    expect(offenders).toEqual([]);
  });
});
