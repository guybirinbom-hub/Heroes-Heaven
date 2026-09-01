import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { FEAT_CANTRIP_GRANTS } from '../src/rules/featCantripGrants';

const db = content();

/**
 * EVERY PICK-A-CANTRIP FEAT MUST ACTUALLY DELIVER ITS SPELL.
 *
 * `FEAT_CANTRIP_GRANTS` is a CODE registry: the grant lives in a TypeScript table rather than on the
 * record, so nothing in the data can show whether it works. Shrouded Magic came out of the batch 3
 * parity read looking like a gap — Wanderer's Guide encodes `select from:SPELL "Select a Cantrip"` and
 * our record carries only an actionCost — and the answer was that the grant does exist, in this table.
 *
 * That answer is only worth anything if the table is READ. This project's most repeated failure is a
 * registry entry that reaches nothing: an id that no longer matches a record, an option list naming a
 * spell we do not ship, a lane whose reader was never wired up. A count of 47 entries proves none of
 * that. So this builds a character for every entry, makes the pick, and asserts the spell arrives.
 *
 * ⚠ It asserts on `pickCantripChoices` flowing through `build()` — the same path the Builder uses —
 * not on the table's contents. A test that reads the table and checks the table passes whether or not
 * the engine ever consults it.
 */
describe('every FEAT_CANTRIP_GRANTS entry reaches a built character', () => {
  const entries = Object.entries(FEAT_CANTRIP_GRANTS);

  it('the registry is not empty (a silent import failure would pass every other test here)', () => {
    expect(entries.length).toBeGreaterThan(20);
  });

  it('every option names a spell we actually ship', () => {
    const missing: string[] = [];
    for (const [featId, spec] of entries) {
      for (const spellId of spec.options ?? []) {
        if (!db.spells[spellId]) missing.push(`${featId} → ${spellId}`);
      }
    }
    expect(missing, 'options pointing at spells that do not exist').toEqual([]);
  });

  it('every feat in the registry exists as a record', () => {
    const dead = entries.filter(([featId]) => !db.feats[featId]).map(([featId]) => featId);
    expect(dead, 'registry keys that match no feat').toEqual([]);
  });

  /*
   * A picked spell lands in the INNATE spellcasting entry — cantrips under `cantrips`, anything of a
   * higher rank under `repertoire`. Reading only one of the two is a mistake this project has made
   * before: the registry grants both (Dragon Spit a cantrip at will, Hag Magic a rank-N spell 1/day),
   * so a check that looks only at `cantrips` reports every higher-rank grant as broken.
   */
  const innateHas = (c: ReturnType<typeof build>, spellId: string) => {
    const innate = c.spellcasting.find((s) => s.type === 'innate');
    if (!innate) return false;
    if ((innate.cantrips ?? []).includes(spellId)) return true;
    return Object.values(innate.repertoire ?? {}).some((rank) => (rank as string[]).includes(spellId));
  };

  it('picking the first option delivers that spell as an innate spell', () => {
    const broken: string[] = [];
    for (const [featId, spec] of entries) {
      const first = (spec.options ?? [])[0];
      if (!first) { broken.push(`${featId}: no options at all`); continue; }
      const c = build('wizard', 20, {
        featPicks: { '1:class:0': featId },
        pickCantripChoices: { [featId]: first },
      });
      if (!innateHas(c, first)) broken.push(`${featId}: picked ${first}, no innate entry appeared`);
    }
    expect(broken, 'pick-a-cantrip feats whose pick reaches nothing').toEqual([]);
  });

  it('Shrouded Magic specifically — the batch 3 record — grants an OCCULT innate cantrip', () => {
    /* *"Choose one cantrip from the occult spell list. You can cast this cantrip as an occult innate
     * spell at will."* Their side models it as a spell select; ours is this registry entry. The
     * tradition is asserted because an entry with no `tradition` falls back to the SPELL's first one,
     * which is how an occult pick previously turned a character into an arcane caster. */
    const spec = FEAT_CANTRIP_GRANTS['shrouded-magic'];
    expect(spec).toBeDefined();
    expect(spec.tradition).toBe('occult');
    const c = build('wizard', 5, {
      featPicks: { '1:class:0': 'shrouded-magic' },
      pickCantripChoices: { 'shrouded-magic': 'daze' },
    });
    const innate = c.spellcasting.find((s) => s.type === 'innate');
    expect(innate, 'the picked occult cantrip should reach the sheet').toBeDefined();
    expect(innate!.cantrips ?? []).toContain('daze');
    expect(innate!.tradition).toBe('occult');
  });
});
