import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { content, build, mainCasting } from './_content';
import { applyPlayState, initialPlay } from '../src/rules/play';

const c = () => content();

describe('deity cleric spells', () => {
  it('are on the deity records, remaster names resolved', () => {
    const withSpells = Object.values(c().deities).filter((d) => d.spells?.length);
    expect(withSpells.length).toBeGreaterThan(450);
    // Every id must resolve, or a picker offers a spell nobody can open.
    for (const d of withSpells) for (const id of d.spells!) expect(c().spells[id], `${d.name} -> ${id}`).toBeTruthy();
    // Abadar's printed three, one of which (Illusory Object) is unchanged and none of which are legacy.
    expect(c().deities.abadar?.spells).toEqual(expect.arrayContaining(['illusory-object', 'creation']));
    // A deity whose printed list uses a LEGACY name: Ragathiel grants True Strike, which the app
    // only has as Sure Strike. Twelve deities list it, and before the rename step all twelve dropped it.
    expect(c().deities.ragathiel?.spells).toContain('sure-strike');
    expect(c().deities.ragathiel?.spells).toHaveLength(3);
  });
});

describe('Blessed Blood (Sorcerer)', () => {
  const sorc = (has: boolean, deityId: string | null) =>
    build('sorcerer', 3, { subclassId: 'draconic', deityId, featPicks: has ? { '1:class:0': 'blessed-blood-sorcerer' } : {} });

  it("adds the character's own deity's spells to the spell list", () => {
    const withIt = sorc(true, 'irori');
    expect(withIt.spellListAdditions?.['*']).toEqual(expect.arrayContaining(c().deities.irori!.spells!));
    // …and a DIFFERENT worshipper gets different spells, which is why it cannot be a static list.
    expect(sorc(true, 'abadar').spellListAdditions?.['*']).toEqual(expect.arrayContaining(c().deities.abadar!.spells!));
    expect(sorc(false, 'irori').spellListAdditions?.['*'] ?? []).not.toEqual(expect.arrayContaining(c().deities.irori!.spells!));
  });

  it('grants nothing when no deity is chosen, rather than guessing one', () => {
    expect(sorc(true, null).spellListAdditions?.['*'] ?? []).toEqual([]);
  });

  /**
   * "Add UP TO THREE of your deity's spells." The cap was read only on the whole-tradition branch, so
   * this one unioned the deity's entire list. Measured over the app's own deity data: 460 deities
   * grant exactly three and TWELVE grant more — nine of them grant NINE, three times the printed cap,
   * and a Nethys sorcerer was handed all nine including the 9th-rank one.
   *
   * WHICH three is the player's and never a slice: at 19th level the 9th-rank spell is the whole
   * point, and "the first three" would be the app putting its own ruling on the sheet dressed as the
   * book's.
   */
  describe('a deity that grants more than three', () => {
    const NINE = 'nethys';
    const picks = (...ids: string[]) => Object.fromEntries(ids.map((id, i) => [`1:class:0#${i}`, id]));
    const withPicks = (fc: Record<string, string>) =>
      build('sorcerer', 20, { subclassId: 'draconic', deityId: NINE, featPicks: { '1:class:0': 'blessed-blood-sorcerer' }, featChoices: fc });

    it('is the case at all — this is not a hypothetical', () => {
      expect(c().deities[NINE]?.spells?.length).toBe(9);
      expect(c().feats['blessed-blood-sorcerer'].spellListAdditions).toMatchObject({ from: 'deity', max: 3 });
      expect(c().feats['blessed-blood-sorcerer'].choice?.picks).toBe(3);
    });

    it('adds exactly the three the player picked', () => {
      const three = ['force-barrage', 'levitate', 'disjunction'];
      expect(withPicks(picks(...three)).spellListAdditions?.['*']).toEqual(three);
    });

    it('adds none of them unanswered, rather than all nine', () => {
      expect(withPicks({}).spellListAdditions?.['*'] ?? []).toEqual([]);
    });

    it('ignores an answer that is not one of that deity’s spells', () => {
      // A retuned or re-deitied character keeps stale answers; a stale one must not smuggle a spell in.
      expect(withPicks(picks('force-barrage', 'fireball')).spellListAdditions?.['*']).toEqual(['force-barrage']);
    });

    it('and a deity at or under the cap is unchanged, answered or not', () => {
      const three = c().deities.abadar!.spells!;
      const bare = build('sorcerer', 20, { subclassId: 'draconic', deityId: 'abadar', featPicks: { '1:class:0': 'blessed-blood-sorcerer' } });
      expect(bare.spellListAdditions?.['*']).toEqual(expect.arrayContaining(three));
    });
  });
});

describe('Mysterious Repertoire', () => {
  it('opens every tradition to the repertoire picker, capped at one', () => {
    const oracle = build('oracle', 14, { subclassId: 'flames', featPicks: { '14:class:0': 'mysterious-repertoire' } });
    const w = (oracle.spellListTraditions ?? [])[0];
    expect(w?.traditions).toBe('any');
    expect(w?.max).toBe(1);
    expect(w?.from).toBe('Mysterious Repertoire');
    // Carried as a RULE — expanding it would put ~1,500 spell ids on every saved character.
    expect(Object.keys(oracle.spellListAdditions ?? {})).toEqual([]);
  });
});

describe('Master Summoner', () => {
  const summoner = (has: boolean) =>
    build('summoner', 10, { subclassId: 'beast', featPicks: has ? { '6:class:0': 'master-summoner' } : {} });

  it('converts one slot into two summoning slots of the same rank', () => {
    const plain = mainCasting(summoner(false));
    const ch = summoner(true);
    const live = applyPlayState(ch, initialPlay(ch, c()), c());
    const entry = live.spellcasting.find((e) => e.type === 'spontaneous')!;
    const group = (entry.restrictedSlots ?? []).filter((s) => s.label === 'Summoning slots');
    expect(group).toHaveLength(2);
    const rank = group[0].rank;
    // Two restricted slots gained, exactly one ordinary slot of that rank spent — not a silent +2.
    expect(entry.slots?.[rank]?.max).toBe((plain?.slots?.[rank]?.max ?? 0) - 1);
  });

  it('accepts only summoning or incarnate spells of its own tradition', () => {
    const ch = summoner(true);
    const live = applyPlayState(ch, initialPlay(ch, c()), c());
    const entry = live.spellcasting.find((e) => e.type === 'spontaneous')!;
    const slot = (entry.restrictedSlots ?? []).find((s) => s.label === 'Summoning slots')!;
    expect(slot.allowed?.length).toBeGreaterThan(5);
    for (const id of slot.allowed!) {
      const sp = c().spells[id];
      expect((sp.traits ?? []).some((t) => t === 'summon' || t === 'incarnate')).toBe(true);
      expect(sp.traditions).toContain(entry.tradition);
    }
  });

  it('lets the player designate any rank they can cast', () => {
    const ch = summoner(true);
    const live = applyPlayState(ch, initialPlay(ch, c()), c());
    const entry = live.spellcasting.find((e) => e.type === 'spontaneous')!;
    const slot = (entry.restrictedSlots ?? []).find((s) => s.label === 'Summoning slots')!;
    expect((slot.rankOptions ?? []).length).toBeGreaterThan(1);
  });

  it('…and the SHEET actually offers the designation to a spontaneous caster', () => {
    /* The lane above was write-only for months: the summoner's slots are `spontaneous`, and
     * SpellsTab's spontaneous branch early-returned BEFORE the one control that reads `rankOptions`
     * — so the printed "designate one of your spell slots" was computed and unanswerable. The engine
     * half is asserted above; this pins the UI half: the spontaneous branch must render the
     * `ms-rank-select` control (a source-shape guard, the same class as the registry-text guards,
     * because no DOM harness exists here and a reader nothing renders is the defect this repo keeps
     * rediscovering). */
    const ch = summoner(true);
    const live = applyPlayState(ch, initialPlay(ch, c()), c());
    const entry = live.spellcasting.find((e) => e.type === 'spontaneous')!;
    const slot = (entry.restrictedSlots ?? []).find((s) => s.label === 'Summoning slots')!;
    expect(slot.spontaneous, 'the summoner slot is the spontaneous shape').toBe(true);
    const src = readFileSync('src/sheet/SpellsTab.tsx', 'utf8');
    const spontaneousBranch = src.slice(src.indexOf('if (slot.spontaneous)'), src.indexOf('// Spell Combination'));
    expect(spontaneousBranch).toContain('ms-rank-select');
    expect(spontaneousBranch).toContain('setRestrictedRank');
  });
});
