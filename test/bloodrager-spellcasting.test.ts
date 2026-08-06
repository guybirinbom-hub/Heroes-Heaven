import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { CASTER_ARCHETYPES } from '../src/rules/casterArchetypes';
import type { BuildState } from '../src/rules/build';
import type { Character, SpellcastingEntry } from '../src/rules/types';

/**
 * The bloodrager archetype never gained a single spell slot.
 *
 * Its table row said `cantripsOnly` because `basic-bloodrager-spellcasting` and its siblings do not
 * ship — which is true, and the wrong conclusion. The three feats whose text is "You gain the
 * benefits" are Rising Blood Magic (4), Surging Blood Magic (12) and Exultant Blood Magic (18).
 */
const db = content();
const ENTRY = 'bloodrager-dedication-casting';

const bloodrager = (level: number, feats: Record<string, string>): Character =>
  build('fighter', level, {
    featPicks: { '2:class': 'bloodrager-dedication', ...feats },
    archetypeTradition: 'arcane',
  } as Partial<BuildState>);

const entry = (c: Character): SpellcastingEntry | undefined => c.spellcasting.find((e) => e.id === ENTRY);
const slotsOf = (c: Character): Record<string, number> =>
  Object.fromEntries(Object.entries(entry(c)?.slots ?? {}).map(([r, p]) => [r, p.max]));

describe('the ladder exists, under other names', () => {
  it('all three rungs ship and are wired', () => {
    const a = CASTER_ARCHETYPES['bloodrager-dedication'];
    expect(a.basicId).toBe('rising-blood-magic');
    expect(a.expertId).toBe('surging-blood-magic');
    expect(a.masterId).toBe('exultant-blood-magic');
    for (const id of [a.basicId!, a.expertId!, a.masterId!]) {
      expect(db.feats[id], `${id} must be a real feat`).toBeTruthy();
      expect(db.feats[id].description).toMatch(/gain the (basic |expert |master )?benefits/i);
    }
  });

  it('the archetype-named feats genuinely do NOT ship — that is why it was missed', () => {
    for (const id of ['basic-bloodrager-spellcasting', 'expert-bloodrager-spellcasting', 'master-bloodrager-spellcasting']) {
      expect(db.feats[id]).toBeUndefined();
    }
  });
});

describe('slots actually arrive', () => {
  it('the dedication alone grants none', () => {
    expect(slotsOf(bloodrager(4, {}))).toEqual({});
  });

  it('Rising Blood Magic opens the first rank', () => {
    expect(slotsOf(bloodrager(4, { '4:class': 'rising-blood-magic' }))['1']).toBe(1);
  });

  it('the ladder climbs with each rung', () => {
    const at12 = slotsOf(bloodrager(12, { '4:class': 'rising-blood-magic', '12:class': 'surging-blood-magic' }));
    expect(Object.keys(at12).length).toBeGreaterThan(1);
    const at20 = slotsOf(
      bloodrager(20, { '4:class': 'rising-blood-magic', '12:class': 'surging-blood-magic', '18:class': 'exultant-blood-magic' }),
    );
    expect(Object.keys(at20).length).toBeGreaterThan(Object.keys(at12).length);
  });

  it("Exultant Blood Magic's second clause adds one slot at EVERY rank", () => {
    expect(db.feats['exultant-blood-magic'].spellSlotBonus).toEqual({ perRank: 1, entryId: ENTRY });
    const without = slotsOf(bloodrager(20, { '4:class': 'rising-blood-magic', '12:class': 'surging-blood-magic' }));
    const withIt = slotsOf(
      bloodrager(20, { '4:class': 'rising-blood-magic', '12:class': 'surging-blood-magic', '18:class': 'exultant-blood-magic' }),
    );
    // Every rank the character already had must go up by one.
    for (const r of Object.keys(without)) {
      expect(withIt[r], `rank ${r}`).toBeGreaterThan(without[r]);
    }
  });

  it('the bonus is pinned to the ARCHETYPE entry, not the class caster', () => {
    // Without entryId the applier falls back to the character's own slot caster, so a bloodrager
    // wizard would have had these land on their wizard slots.
    expect(db.feats['exultant-blood-magic'].spellSlotBonus?.entryId).toBe(ENTRY);
    const wiz = build('wizard', 20, {
      featPicks: { '2:class': 'bloodrager-dedication', '4:class': 'rising-blood-magic', '18:class': 'exultant-blood-magic' },
      archetypeTradition: 'arcane',
    } as Partial<BuildState>);
    const own = wiz.spellcasting.find((e) => e.id !== ENTRY && e.type === 'prepared');
    const plain = build('wizard', 20);
    const plainOwn = plain.spellcasting.find((e) => e.type === 'prepared');
    const count = (e?: SpellcastingEntry) => Object.values(e?.prepared ?? {}).reduce((n, a) => n + a.length, 0);
    expect(count(own), "the wizard's own slots must be untouched").toBe(count(plainOwn));
  });
});

describe('nobody else is affected', () => {
  it('a fighter without the dedication has no archetype entry', () => {
    expect(entry(build('fighter', 20))).toBeUndefined();
  });
});
