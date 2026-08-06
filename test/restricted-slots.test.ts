import { describe, it, expect } from 'vitest';
import { build, content, firstSubclass } from './_content';
import { applyPlayState, emptyPlay, setRestrictedSpell, setRestrictedRank, toggleExpended } from '../src/rules/play';
import type { Character } from '../src/rules/types';

/**
 * Restricted spell slots: extra slots that may hold only certain spells.
 *
 * Every one of these records previously either did not build at all or shipped as ORDINARY slots
 * plus a warning, which over-grants — four unrestricted casts a day is not what Conscious Spell
 * Specialization gives a psychic.
 */
const db = content();
const rs = (ch: Character, entryId?: string) =>
  (ch.spellcasting.find((e) => (entryId ? e.id === entryId : !!e.restrictedSlots?.length))?.restrictedSlots ?? []);

describe('Conscious Spell Specialization — psychic, conscious-mind only', () => {
  const at = (level: number) =>
    build('psychic', level, { featPicks: { '14:class:0': 'conscious-spell-specialization' }, subclassId: firstSubclass('psychic') });

  it('grants four restricted slots at 14 and a fifth at 18 — never plain slots', () => {
    const ch = at(14);
    const slots = rs(ch, 'psychic-casting');
    expect(slots.map((s) => s.rank)).toEqual([1, 2, 3, 4]);
    // The whole point: these are NOT in the ordinary pool.
    const plain = build('psychic', 14, { subclassId: firstSubclass('psychic') });
    const pool = (e: Character) => JSON.stringify(e.spellcasting.find((x) => x.id === 'psychic-casting')?.slots);
    expect(pool(ch)).toEqual(pool(plain));
    expect(rs(at(18), 'psychic-casting').map((s) => s.rank)).toEqual([1, 2, 3, 4, 5]);
    // …and not before 18.
    expect(rs(at(17), 'psychic-casting').map((s) => s.rank)).toEqual([1, 2, 3, 4]);
  });

  it('the allowed list is the conscious mind’s own spells, resolved from the subclass', () => {
    const ch = at(14);
    const granted = new Set(Object.values(ch.spellcasting.find((e) => e.id === 'psychic-casting')?.grantedRepertoire ?? {}).flat());
    expect(granted.size).toBeGreaterThan(0);
    for (const slot of rs(ch, 'psychic-casting')) {
      expect(slot.allowed?.length, 'allowed list').toBeGreaterThan(0);
      for (const id of slot.allowed ?? []) expect(granted.has(id), id).toBe(true);
    }
  });

  it('a spontaneous caster prepares nothing into them — they are extra casts', () => {
    for (const slot of rs(at(14), 'psychic-casting')) expect(slot.spontaneous).toBe(true);
  });
});

describe('Creed Magic — two slots that MOVE rank, and a list that grows', () => {
  const at = (level: number) =>
    build('cleric', level, { featPicks: { '8:class:0': 'creed-magic' }, subclassId: firstSubclass('cleric') });

  it('is always two slots — the rank increases, the count does not', () => {
    for (const level of [8, 10, 14, 20]) {
      expect(rs(at(level), 'cleric-casting').length, `level ${level}`).toBe(2);
    }
  });

  it('2nd rank at 8, 3rd at 10, 4th at 14', () => {
    expect(rs(at(8), 'cleric-casting').map((s) => s.rank)).toEqual([2, 2]);
    expect(rs(at(9), 'cleric-casting').map((s) => s.rank)).toEqual([2, 2]);
    expect(rs(at(10), 'cleric-casting').map((s) => s.rank)).toEqual([3, 3]);
    expect(rs(at(13), 'cleric-casting').map((s) => s.rank)).toEqual([3, 3]);
    expect(rs(at(14), 'cleric-casting').map((s) => s.rank)).toEqual([4, 4]);
  });

  it('the allowed list accumulates: 4 spells, then 6, then 8', () => {
    expect(rs(at(8), 'cleric-casting')[0].allowed).toEqual(['resist-energy', 'see-the-unseen', 'sure-strike', 'water-breathing']);
    expect(rs(at(10), 'cleric-casting')[0].allowed).toHaveLength(6);
    expect(rs(at(14), 'cleric-casting')[0].allowed).toHaveLength(8);
    expect(rs(at(14), 'cleric-casting')[0].allowed).toContain('unfettered-movement');
  });

  it('a cleric without the feat has none', () => {
    expect(rs(build('cleric', 14, { subclassId: firstSubclass('cleric') }), 'cleric-casting')).toEqual([]);
  });
});

describe('Sin Reservoir — one slot whose rank the player chooses', () => {
  const at = (level: number) => build('wizard', level, { featPicks: { '8:class:0': 'sin-reservoir' }, subclassId: firstSubclass('wizard') });

  it('is one slot, offering every rank up to two below the highest', () => {
    const ch = at(8); // a wizard casts 4th rank at 8 → 1st and 2nd are offered
    const slots = rs(ch, 'wizard-casting');
    expect(slots).toHaveLength(1);
    expect(slots[0].rankOptions).toEqual([1, 2]);
    expect(slots[0].rank).toBe(2); // defaults to the highest it may reach
    // At 20 a wizard casts 10th rank, so everything up to 8th is on offer.
    const top = rs(at(20), 'wizard-casting')[0];
    expect(top.rankOptions?.[top.rankOptions.length - 1]).toBe(top.rank);
    expect(top.rank).toBeGreaterThanOrEqual(8);
  });

  it('carries the curriculum restriction as prose — the app cannot resolve a wizard curriculum', () => {
    // The school's spell list lives only in its description text, so pretending to filter would be
    // worse than showing the sentence.
    const slot = rs(at(8), 'wizard-casting')[0];
    expect(slot.allowed).toBeUndefined();
    expect(slot.note).toMatch(/curriculum/i);
  });
});

describe('a lit Candle of Invocation — a mode, because a candle is lit and not invested', () => {
  it('grants two slots at half your highest rank while the mode is on', () => {
    const ch = build('cleric', 16, { subclassId: firstSubclass('cleric') }); // 8th-rank slots at 16
    expect(rs(ch, 'cleric-casting')).toEqual([]);
    const lit = applyPlayState(ch, { ...emptyPlay(), activeModes: ['item-candle-of-invocation'] }, db);
    const slots = rs(lit, 'cleric-casting');
    // "4th rank slots if the caster can cast 8th-rank spells" — the example printed on the item.
    expect(slots.map((s) => s.rank)).toEqual([4, 4]);
  });

  it('goes away when the candle does', () => {
    const ch = build('cleric', 16, { subclassId: firstSubclass('cleric') });
    expect(rs(applyPlayState(ch, emptyPlay(), db), 'cleric-casting')).toEqual([]);
  });
});

describe('using a restricted slot in play', () => {
  const ch = build('cleric', 14, { featPicks: { '8:class:0': 'creed-magic' }, subclassId: firstSubclass('cleric') });
  const slotId = rs(ch, 'cleric-casting')[0].id;

  it('prepares a spell into it and marks it cast', () => {
    let p = setRestrictedSpell(emptyPlay(), slotId, 'fly');
    expect(rs(applyPlayState(ch, p, db), 'cleric-casting')[0].spellId).toBe('fly');
    p = toggleExpended(p, slotId);
    const after = rs(applyPlayState(ch, p, db), 'cleric-casting');
    expect(after[0].expended).toBe(true);
    // …and only that slot: the second creed slot is untouched.
    expect(after[1].expended).toBe(false);
    expect(after[1].spellId).toBe(null);
  });

  it('moving a Sin Reservoir slot to another rank empties it', () => {
    const wiz = build('wizard', 8, { featPicks: { '8:class:0': 'sin-reservoir' }, subclassId: firstSubclass('wizard') });
    const id = rs(wiz, 'wizard-casting')[0].id;
    let p = setRestrictedSpell(emptyPlay(), id, 'fly');
    expect(rs(applyPlayState(wiz, p, db), 'wizard-casting')[0].spellId).toBe('fly');
    // A 2nd-rank spell chosen for a 2nd-rank slot cannot follow it down to 1st.
    p = setRestrictedRank(p, id, 1);
    const moved = rs(applyPlayState(wiz, p, db), 'wizard-casting')[0];
    expect(moved.rank).toBe(1);
    expect(moved.spellId).toBe(null);
  });

  it('a rank outside the offered options is ignored', () => {
    const wiz = build('wizard', 8, { featPicks: { '8:class:0': 'sin-reservoir' }, subclassId: firstSubclass('wizard') });
    const id = rs(wiz, 'wizard-casting')[0].id;
    const p = setRestrictedRank(emptyPlay(), id, 9);
    expect(rs(applyPlayState(wiz, p, db), 'wizard-casting')[0].rank).toBe(2);
  });
});
