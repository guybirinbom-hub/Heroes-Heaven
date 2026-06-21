import { describe, it, expect } from 'vitest';
import {
  applyPlayState,
  initialPlay,
  preparedKey,
  resetPreparedEntry,
  resetRepertoire,
  setPreparedSpell,
  setRepertoireRank,
  setSignatureSpells,
} from '../src/rules/play';
import { content, build } from './_content';

const c = content();
const ch = build('cleric', 5, { keyAbility: 'wis' });
const entry = ch.spellcasting.find((e) => e.prepared)!;
const rank = Object.keys(entry.prepared!)
  .map(Number)
  .sort((a, b) => a - b)[0];
const slotSpell = (chr: typeof ch, eid: string, r: number, i: number) =>
  chr.spellcasting.find((e) => e.id === eid)!.prepared![r][i].spellId;

describe('in-play preparation (Manage Spells)', () => {
  it('a prepared caster exposes slots to re-prepare', () => {
    expect(entry).toBeTruthy();
    expect((entry.prepared![rank] ?? []).length).toBeGreaterThan(0);
  });

  it('setPreparedSpell overrides a slot and applyPlayState reflects it', () => {
    const play = setPreparedSpell(initialPlay(ch, c), entry.id, rank, 0, 'heal');
    expect(play.preparedSpells![preparedKey(entry.id, rank, 0)]).toBe('heal');
    expect(slotSpell(applyPlayState(ch, play, c), entry.id, rank, 0)).toBe('heal');
  });

  it('re-preparing clears that slot’s expended flag', () => {
    const key = preparedKey(entry.id, rank, 0);
    let play = initialPlay(ch, c);
    play = { ...play, expendedSlots: { ...play.expendedSlots, [key]: true } };
    play = setPreparedSpell(play, entry.id, rank, 0, 'heal');
    expect(play.expendedSlots[key]).toBeUndefined();
  });

  it('null empties the slot', () => {
    const play = setPreparedSpell(initialPlay(ch, c), entry.id, rank, 0, null);
    expect(slotSpell(applyPlayState(ch, play, c), entry.id, rank, 0)).toBeNull();
  });

  it('resetPreparedEntry reverts to the build’s preparation', () => {
    const orig = slotSpell(ch, entry.id, rank, 0);
    let play = setPreparedSpell(initialPlay(ch, c), entry.id, rank, 0, 'heal');
    play = resetPreparedEntry(play, entry.id);
    expect(slotSpell(applyPlayState(ch, play, c), entry.id, rank, 0)).toBe(orig);
  });
});

describe('in-play repertoire + signature (spontaneous)', () => {
  const bard = build('bard', 5, { keyAbility: 'cha' });
  const sentry = bard.spellcasting.find((e) => e.repertoire)!;
  const srank = Object.keys(sentry.repertoire!)
    .map(Number)
    .sort((a, b) => a - b)[0];
  const repOf = (chr: typeof bard, eid: string, r: number) =>
    chr.spellcasting.find((e) => e.id === eid)!.repertoire![r];
  const sigOf = (chr: typeof bard, eid: string) => chr.spellcasting.find((e) => e.id === eid)!.signature ?? [];

  it('bard is a spontaneous caster with a repertoire', () => {
    expect(sentry).toBeTruthy();
    expect(sentry.repertoire![srank]).toBeDefined();
  });

  it('setRepertoireRank adds a known spell, overlaid by applyPlayState', () => {
    const cur = sentry.repertoire![srank] ?? [];
    const play = setRepertoireRank(initialPlay(bard, c), sentry.id, srank, [...cur, 'fear']);
    expect(repOf(applyPlayState(bard, play, c), sentry.id, srank)).toContain('fear');
  });

  it('setSignatureSpells overlays the signature list', () => {
    const play = setSignatureSpells(initialPlay(bard, c), sentry.id, ['fear']);
    expect(sigOf(applyPlayState(bard, play, c), sentry.id)).toContain('fear');
  });

  it('resetRepertoire reverts repertoire + signature to the build defaults', () => {
    let play = setRepertoireRank(initialPlay(bard, c), sentry.id, srank, ['fear']);
    play = setSignatureSpells(play, sentry.id, ['fear']);
    play = resetRepertoire(play, sentry.id);
    const applied = applyPlayState(bard, play, c);
    expect(repOf(applied, sentry.id, srank)).toEqual(sentry.repertoire![srank]);
    expect(sigOf(applied, sentry.id)).toEqual(sentry.signature ?? []);
  });
});
