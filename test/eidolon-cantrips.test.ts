import { describe, it, expect } from 'vitest';
import { build, content, firstSubclass } from './_content';
import { deriveEidolon, eidolonCantripSlots } from '../src/rules/companions';
import type { CompanionConfig } from '../src/rules/types';

/**
 * Magical Understudy: "Your eidolon evolves to cast spells. It gains the Cast a Spell activity and
 * learns two cantrips of its tradition, which it can cast as innate spells."
 *
 * The eidolon had no spellcasting at all, so the only place the feat could have put these was its own
 * `innateSpells` — which would have handed them to the SUMMONER.
 */
const db = content();
const subclassId = firstSubclass('summoner');
const tradition = db.classes.summoner?.subclass?.options?.find((o) => o.id === subclassId)?.tradition;
const cantripsOfTradition = Object.values(db.spells)
  .filter((s) => s.rank === 0 && !s.ritual && (!tradition || (s.traditions ?? []).includes(tradition)))
  .slice(0, 2);

const summoner = (picks: Record<string, string> = {}) => build('summoner', 6, { subclassId, featPicks: picks });
const cfg = (cantrips?: (string | null)[]): CompanionConfig =>
  ({ id: 'e', kind: 'eidolon', name: '', typeId: subclassId, ...(cantrips ? { eidolon: { cantrips } } : {}) }) as CompanionConfig;

describe('Magical Understudy — the eidolon casts, not the summoner', () => {
  it('grants two cantrip slots, and none without the feat', () => {
    expect(eidolonCantripSlots(summoner(), db)).toBe(0);
    expect(eidolonCantripSlots(summoner({ '2:class:0': 'magical-understudy' }), db)).toBe(2);
  });

  it('the chosen cantrips appear on the EIDOLON’s block', () => {
    expect(cantripsOfTradition, 'no cantrips of the eidolon’s tradition to test with').toHaveLength(2);
    const ch = summoner({ '2:class:0': 'magical-understudy' });
    const block = deriveEidolon(cfg(cantripsOfTradition.map((s) => s.id)), ch, db);
    expect(block.cantrips).toEqual(cantripsOfTradition.map((s) => s.name));
  });

  it('…and NOT on the summoner’s own spell list', () => {
    const ch = summoner({ '2:class:0': 'magical-understudy' });
    const own = ch.spellcasting.flatMap((e) => e.cantrips ?? []);
    for (const s of cantripsOfTradition) expect(own, s.name).not.toContain(s.id);
  });

  it('an unfilled or unknown slot puts nothing on the block', () => {
    const ch = summoner({ '2:class:0': 'magical-understudy' });
    expect(deriveEidolon(cfg([null, null]), ch, db).cantrips).toBeUndefined();
    expect(deriveEidolon(cfg(['not-a-real-spell', null]), ch, db).cantrips).toBeUndefined();
    expect(deriveEidolon(cfg(), ch, db).cantrips).toBeUndefined();
  });
});
