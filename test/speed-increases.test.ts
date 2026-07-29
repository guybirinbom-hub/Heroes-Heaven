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
    // monk-moves keeps speeds.land on purpose: its +10 applies only while unarmored, and the
    // unconditional field would over-grant. tillers-drive REPLACES another feat's bonus.
    expect(bad.sort()).toEqual(['feats/monk-moves', 'feats/tillers-drive']);
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
