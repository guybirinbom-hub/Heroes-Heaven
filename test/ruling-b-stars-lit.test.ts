import { afterAll, describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { derivePerception, deriveSkill, deriveSpeeds } from '../src/rules/derive';
import { statHasSituational, type StatRef } from '../src/rules/explain';
import { modeRelevant } from '../src/rules/modes';
import { FEAT_SITUATIONAL, setSituationalTrustOff } from '../src/rules/situationalBonuses';
import { TRUST_LEDGER } from '../src/data/trustGate';
import type { Character, ContentDatabase, InventoryItem, ProficiencyKey } from '../src/rules/types';

/**
 * DESK #177 (2026-10-17) — the sixteen Ruling-B stars switched ON, their too-broad numbers removed, read with
 * the TRUST GATE ON, as every player sees the app.
 *
 * The question, as asked in chat: "16 items/feats show a bonus on EVERY roll although the book limits it (e.g.
 * Clarity Goggles +3 to all Perception, book: only checks that use sight). Their correct starred note exists but
 * is switched off because Wanderer's Guide has no note there. Switch those stars on and remove the too-broad
 * numbers?" His pick: 'Yes, stars on (Recommended)' (work/desk-answers-2026-10-17.json). So:
 *   · each item's FEAT_SITUATIONAL star is off the trust ledger's suppressed list (sixteen `situational`
 *     approvals in scripts/data/trust-approvals.json), and Rope Runner's own star and modes/cat-rope-runner
 *     with them;
 *   · each number that applied to EVERY check left the record (one overlay row each), so a character wearing
 *     the item has the same total as without it, and the star on that stat states print's restriction.
 * Print per record (the row's AoN page): e.g. equipment-2314-2161 "you gain a +1 item bonus to visual Perception
 * checks" (+3 for the Greater grade), equipment-3273 "a +2 item bonus to Diplomacy checks against all creatures
 * except fiends", feat-6380 "a climb Speed of 15 feet, but only when climbing ropes and similar objects".
 *
 * Each leg is mutation-proved in memory: the old number planted back moves the total, the old suppressed list
 * hides the star. Synthetic characters only ("TEST …").
 */
const gated = content({ trustGate: true });
afterAll(() => setSituationalTrustOff(TRUST_LEDGER.lanes.situational));

type Stat = 'perception' | ProficiencyKey;
const CASES: { id: string; stat: Stat; old: number; bonus: RegExp; aon: string }[] = [
  { id: 'bagpipes-of-turmoil', stat: 'performance', old: 1, bonus: /^\+1 item$/, aon: 'equipment-2265' },
  { id: 'borts-blessing', stat: 'diplomacy', old: 1, bonus: /^\+1 item$/, aon: 'equipment-476' },
  { id: 'clarity-goggles-greater', stat: 'perception', old: 3, bonus: /^\+3 item$/, aon: 'equipment-2314-2161' },
  { id: 'day-goggles', stat: 'perception', old: -2, bonus: /^-2 item/, aon: 'equipment-1146' },
  { id: 'eye-slash-greater', stat: 'perception', old: 1, bonus: /^\+1 item$/, aon: 'equipment-2206-1905' },
  { id: 'eye-slash-major', stat: 'perception', old: 2, bonus: /^\+2 item$/, aon: 'equipment-2206-1906' },
  { id: 'eye-slash-true', stat: 'perception', old: 3, bonus: /^\+3 item$/, aon: 'equipment-2206-1907' },
  { id: 'holy-chain', stat: 'diplomacy', old: 2, bonus: /^\+2 item$/, aon: 'equipment-3273' },
  { id: 'mirror-goggles-lesser', stat: 'perception', old: 1, bonus: /^\+1 item$/, aon: 'equipment-2315-2162' },
  { id: 'persona-mask', stat: 'performance', old: 1, bonus: /^\+1 item$/, aon: 'equipment-3099-3044' },
  { id: 'persona-mask-greater', stat: 'performance', old: 2, bonus: /^\+2 item$/, aon: 'equipment-3099-3045' },
  { id: 'razmiri-wayfinder', stat: 'deception', old: 1, bonus: /^\+1 item$/, aon: 'equipment-470-832' },
  { id: 'resonant-guitar', stat: 'performance', old: 2, bonus: /^\+2 item$/, aon: 'equipment-2616' },
  { id: 'shining-hackle', stat: 'perception', old: 1, bonus: /^\+1 item$/, aon: 'equipment-3978' },
  { id: 'wardrobe-stone-greater', stat: 'perception', old: 3, bonus: /^\+3 item$/, aon: 'equipment-1323-1222' },
];

const base = (d: ContentDatabase): Character =>
  buildCharacter(
    {
      ...emptyBuild(),
      name: 'TEST ruling-b stars',
      level: 12,
      classId: 'bard',
      keyAbility: 'cha',
      ancestryId: 'human',
      backgroundId: Object.keys(d.backgrounds)[0],
    } as BuildState,
    d,
  );
const using = (c: Character, itemId: string): Character => ({
  ...c,
  inventory: [...c.inventory, { instanceId: `rb-${itemId}`, itemId, quantity: 1, equipped: true, worn: true, invested: true } as InventoryItem],
});
const total = (c: Character, d: ContentDatabase, stat: Stat) => (stat === 'perception' ? derivePerception(c, d).modifier : deriveSkill(c, stat, d).modifier);
const refOf = (stat: Stat): StatRef => (stat === 'perception' ? { kind: 'perception' } : { kind: 'skill', skill: stat });
const starRow = (id: string, stat: Stat) =>
  (FEAT_SITUATIONAL[id] ?? []).find((r) => r.targets.some((t) => (stat === 'perception' ? t.kind === 'perception' : t.kind === 'skill' && t.detail === stat)));
/** The database with one item's old passiveEffects planted back — the bad case, in memory only. */
const withOld = (id: string, old: Record<string, unknown>): ContentDatabase =>
  ({ ...gated, items: { ...gated.items, [id]: { ...gated.items[id], passiveEffects: old } } }) as ContentDatabase;

describe('#177, trust gate ON: the fifteen item stars are lit and their numbers gone', () => {
  it('the shipped ledger suppresses none of the fifteen stars', () => {
    const off = new Set(TRUST_LEDGER.lanes.situational);
    expect(CASES.filter((k) => off.has(k.id)).map((k) => k.id)).toEqual([]);
  });

  it('wearing (or playing) each item leaves the ordinary total at the printed number without it', () => {
    const c = base(gated);
    for (const k of CASES) expect(total(using(c, k.id), gated, k.stat) - total(c, gated, k.stat), k.id).toBe(0);
  });

  it('each shows its star on the right stat, worded as print restricts it and claiming nothing is in the total', () => {
    const c = base(gated);
    for (const k of CASES) {
      expect(statHasSituational(c, refOf(k.stat), gated), `${k.id}: fixture, no star without the item`).toBe(false);
      expect(statHasSituational(using(c, k.id), refOf(k.stat), gated), k.id).toBe(true);
      const row = starRow(k.id, k.stat);
      expect(row?.bonus, k.id).toMatch(k.bonus);
      expect(row?.when, k.id).not.toMatch(/already in your total/);
    }
  });

  it("the Holy Chain's Diplomacy star is the +2 itself, against everyone but a fiend (equipment-3273)", () => {
    const row = starRow('holy-chain', 'diplomacy');
    expect(row).toEqual({ targets: [{ kind: 'skill', detail: 'diplomacy' }], when: expect.stringMatching(/except a fiend/), bonus: '+2 item' });
  });

  it('Mirror Goggles (Lesser) also star the saves (against visual effects); the Shining Hackle keeps its printed -1 Stealth as a number', () => {
    const c = base(gated);
    expect(statHasSituational(using(c, 'mirror-goggles-lesser'), { kind: 'save', save: 'will' }, gated)).toBe(true);
    expect(total(using(c, 'shining-hackle'), gated, 'stealth') - total(c, gated, 'stealth')).toBe(-1);
    // the far-sight sense stays on the record (dark under the gate before and after #177: WG encodes no sense here)
    expect(content().items['eye-slash-true'].passiveEffects, 'the far-sight sense stays').toEqual({ senses: [{ name: 'see four times farther than normal' }] });
    expect(TRUST_LEDGER.records['items/eye-slash-true']).toEqual(['passiveEffects.senses']);
  });

  // mutation-proof
  it('planted: each old number back on the record moves the total again (Day Goggles excepted: a negative item Perception never reaches the total, derive.ts passiveItemPenalty)', () => {
    const c = base(gated);
    for (const k of CASES) {
      if (k.old < 0) continue;
      const old = k.stat === 'perception' ? { perception: k.old } : { skills: { [k.stat]: k.old } };
      const bad = withOld(k.id, old);
      expect(total(using(c, k.id), bad, k.stat) - total(c, bad, k.stat), k.id).toBe(k.old);
    }
  });

  it('planted: the pre-#177 suppressed list hides every one of the fifteen stars again', () => {
    const c = base(gated);
    setSituationalTrustOff([...TRUST_LEDGER.lanes.situational, ...CASES.map((k) => k.id)]);
    try {
      for (const k of CASES) expect(statHasSituational(using(c, k.id), refOf(k.stat), gated), k.id).toBe(false);
    } finally {
      setSituationalTrustOff(TRUST_LEDGER.lanes.situational);
    }
    for (const k of CASES) expect(statHasSituational(using(c, k.id), refOf(k.stat), gated), k.id).toBe(true);
  });
});

describe('#177, trust gate ON: Rope Runner — "a climb Speed of 15 feet, but only when climbing ropes" (feat-6380)', () => {
  const rope = (d: ContentDatabase, over: Partial<Character> = {}): Character => {
    const c = base(d);
    return { ...c, feats: [...c.feats, { featId: 'rope-runner', level: 4, category: 'skill' } as Character['feats'][number]], ...over };
  };
  const MODE = 'cat-rope-runner';

  it('no standing climb Speed; the Speed row carries the star', () => {
    expect(gated.feats['rope-runner'].speeds).toBeUndefined();
    expect(gated.feats['rope-runner'].situational?.length).toBeGreaterThan(0);
    expect(TRUST_LEDGER.records['feats/rope-runner'], 'the record star is on').toBeUndefined();
    expect(deriveSpeeds(rope(gated), gated).climb).toBeUndefined();
    expect(statHasSituational(rope(gated), { kind: 'speed' }, gated)).toBe(true);
    expect(statHasSituational(base(gated), { kind: 'speed' }, gated), 'fixture: not without the feat').toBe(false);
  });

  it('the On Ropes mode is offered to the feat and gives climb 15 while it is on', () => {
    const m = gated.modes[MODE];
    expect(TRUST_LEDGER.lanes.modes, 'the mode is off the suppressed list').not.toContain(MODE);
    expect(m.speeds).toEqual({ climb: 15 });
    expect(modeRelevant(m, 'bard', 'human', new Set(['rope-runner']))).toBe(true);
    expect(modeRelevant(m, 'bard', 'human', new Set())).toBe(false);
    expect(deriveSpeeds(rope(gated, { activeModes: [m] }), gated).climb).toBe(15);
  });

  // mutation-proof
  it('planted: the old standing climb 15 is caught, and so is the mode with its payload stripped (as the gate did before #177)', () => {
    const old = { ...gated, feats: { ...gated.feats, 'rope-runner': { ...gated.feats['rope-runner'], speeds: { climb: 15 } } } } as ContentDatabase;
    expect(deriveSpeeds(rope(old), old).climb).toBe(15);
    const stripped = { ...gated.modes[MODE], speeds: undefined };
    expect(deriveSpeeds(rope(gated, { activeModes: [stripped] }), gated).climb).toBeUndefined();
  });
});
