import { describe, it, expect } from 'vitest';
import { build } from './_content';

/**
 * Summoner — Unlimited Signature Spells (level 3): every spell in the summoner's repertoire is a
 * signature spell, so it can be heightened to any spell-slot rank the summoner can cast. The engine
 * must mark the whole repertoire as `signature`; previously only the bard's `signature-spells`
 * feature was recognized, so summoners could never heighten their known spells.
 */
describe('summoner unlimited signature spells', () => {
  it('marks every repertoire spell as signature at level 3+', () => {
    // A two-rank summoner at L5 has slots at ranks 2–3, so stock those ranks.
    const ch = build('summoner', 5, { spells: { 2: ['acid-arrow'], 3: ['agonizing-despair'] } });
    const entry = ch.spellcasting.find((e) => e.id === 'summoner-casting');
    expect(entry, 'summoner should have a spellcasting entry').toBeTruthy();
    const repertoireSpells = [...new Set(Object.values(entry!.repertoire ?? {}).flat())];
    expect(repertoireSpells.length).toBeGreaterThan(0);
    // Every repertoire spell is a signature spell (set-equal, order-independent).
    expect(new Set(entry!.signature)).toEqual(new Set(repertoireSpells));
    expect(entry!.signature).toContain('acid-arrow');
  });

  it('does not mark signatures before level 3', () => {
    const ch = build('summoner', 1, { spells: { 1: ['500-toads'] } });
    const entry = ch.spellcasting.find((e) => e.id === 'summoner-casting');
    expect(entry?.signature ?? []).toEqual([]);
  });
});
