import { describe, it, expect } from 'vitest';
import { findUmbrellaIds, listValues } from '../src/data';
import { content } from './_content';
import type { ContentDatabase, Item } from '../src/rules/types';

const db = (): ContentDatabase => {
  const c = content();
  return { ...c, umbrellaIds: findUmbrellaIds(c.items as unknown as Record<string, unknown>) };
};
const umbrellas = () => findUmbrellaIds(content().items as unknown as Record<string, unknown>);

describe('umbrella detection', () => {
  it('finds the AoN family summaries', () => {
    // Measured, not guessed: this is what the conditions catch over the shipped items.
    // It rose from 439 when ruling B stripped the leaked flat bonus off `maestros-instrument` and
    // `camouflaging-chromatophores` — both are summary rows, and the bonus was the only thing that
    // had been sparing them. The two rulings agreeing on those records is the point, not a surprise.
    // Back to 439 with `peachwood` and `peachwood-weapon`, two family summaries a fresher AoN export
    // brought in — new content, not a change in what detection catches.
    // 440 with `poets-fritter`, from the Bastion of Blasphemies import. AoN heads that page "Item 7+"
    // (equipment-5203 — the id we imported this record from, unpriced) above three level-2 grade
    // blocks, and the app carries all three of those priced: a textbook summary, so the ratchet
    // legitimately rises by one.
    // The same import raised the count by TWO, and the second was a defect rather than content:
    // `soulheart` is equipment-5194-4715, the "Item 5" grade block of that page, and price + kin
    // caught it only because artifacts are priceless. Hiding it would have deleted the base artifact
    // and left only Greater/Major/Pure. See `blockOfAPage` in src/data — an AoN block id now proves a
    // record is one of the grades, so the fourth condition spares it and the count is 440, not 441.
    expect(umbrellas().size).toBe(440);
  });

  it('hides the summaries the owner named', () => {
    const u = umbrellas();
    for (const id of [
      'bestial-mutagen', 'drakeheart-mutagen', 'sanguine-mutagen', 'deadweight-mutagen',
      'bendy-arm-mutagen', 'malleable-mixture', 'red-rib-gill-mask', 'colorful-coating',
      'emetic-paste', 'healing-vapor', 'sense-dulling-hood', 'affliction-suppressant',
      'magnetic-shot', 'midnight-milk', 'crimson-godsblood-serum', 'essence-forge',
      'psyche-salts', 'privacy-ward-fulu', 'conrasu-coin', 'fixer', 'exploration-lens',
      'aon-magical-medals',
    ]) {
      expect(u.has(id), `${id} should be hidden`).toBe(true);
    }
  });

  it('spares the four the AoN audit proved are real items', () => {
    // An audit of all 438 candidates against the pristine AoN mirror found four where the
    // price-and-kin rule disagrees with AoN's own family marker. Three are priced base items whose
    // app variants do not cover the base — hiding them would delete the item from the game.
    const u = umbrellas();
    for (const id of ['judgement-thurible', 'spore-shepherds-staff', 'razmiri-mask', 'inspiring']) {
      expect(u.has(id), `${id} is a real record and must stay visible`).toBe(false);
    }
  });

  it('leaves every grade of a hidden family visible', () => {
    // Hiding a whole family would be far worse than showing a summary. Nothing may be hidden unless
    // at least one of its variants survives.
    const u = umbrellas();
    const items = content().items;
    const ids = Object.keys(items);
    const orphaned: string[] = [];
    for (const id of u) {
      const kin = ids.filter((k) => k !== id && k.startsWith(id + '-'));
      if (kin.length && !kin.some((k) => !u.has(k))) orphaned.push(id);
    }
    expect(orphaned).toEqual([]);
  });
});

describe('what must NOT be hidden', () => {
  const u = () => umbrellas();

  it('an item the app resolves a choice for stays visible', () => {
    // Energy Robe is unpriced with four AoN rows behind it — one per energy type — and would have
    // been hidden by price + kin alone. It carries effectChoices: it IS the ownable one.
    expect(u().has('energy-robe')).toBe(false);
    expect((content().items['energy-robe'] as Item).effectChoices).toBeTruthy();
  });

  it('free weapons stay visible', () => {
    // `staff` and `sling` cost nothing and have magic namesakes behind them; their damage saves them.
    expect(u().has('staff')).toBe(false);
    expect(u().has('sling')).toBe(false);
  });

  it('nothing with a price is ever hidden', () => {
    const items = content().items as Record<string, Item>;
    const priced = [...u()].filter((id) => {
      const p = items[id]?.price;
      return p && Object.values(p).some(Boolean);
    });
    expect(priced).toEqual([]);
  });

  it('nothing the engine reads a field off is ever hidden', () => {
    const items = content().items as unknown as Record<string, Record<string, unknown>>;
    const FIELDS = ['passiveEffects', 'effectChoices', 'situational', 'uses', 'spell', 'runes', 'damage', 'acBonus', 'capacity', 'value'];
    const mechanical = [...u()].filter((id) =>
      // The explicit list is by-id on purpose and exempt from the field rule.
      id !== 'aon-magical-medals' && FIELDS.some((f) => {
        const v = items[id]?.[f];
        return v != null && (!Array.isArray(v) || v.length > 0);
      }),
    );
    expect(mechanical).toEqual([]);
  });
});

describe('hidden, not deleted', () => {
  it('the item picker stops offering them', () => {
    const c = db();
    const listed = new Set(listValues(c, c.items).map((i) => i.id));
    for (const id of ['bestial-mutagen', 'colorful-coating', 'fixer']) expect(listed.has(id)).toBe(false);
  });

  it('a character who already owns one still resolves it', () => {
    // The whole reason these are hidden rather than removed: characters store raw ids, and an id that
    // vanishes takes the item off the sheet.
    const c = db();
    expect(c.items['bestial-mutagen']).toBeTruthy();
    expect(c.items['bestial-mutagen'].name).toBeTruthy();
  });

  it('a non-item list is unaffected', () => {
    // The umbrella set is item-only; passing it another map must not filter anything by accident.
    const c = db();
    expect(listValues(c, c.spells).length).toBe(listValues({ ...c, umbrellaIds: undefined }, c.spells).length);
  });
});
