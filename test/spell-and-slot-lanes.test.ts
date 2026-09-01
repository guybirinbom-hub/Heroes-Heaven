import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { build, content, grantPicker } from './_content';
import type { BuildState } from '../src/rules/build';
import type { Character, SpellcastingEntry } from '../src/rules/types';

/**
 * Records the re-verification found fixable once `spellListAdditions` and the slot lanes existed —
 * plus one over-grant bug found while wiring them.
 */
const db = content();

const focusSpells = (c: Character): string[] =>
  c.spellcasting.filter((e) => e.type === 'focus').flatMap((e) => Object.values(e.repertoire ?? {}).flat());
const mainSlots = (c: Character): Record<string, number> => {
  const e = c.spellcasting.find((x) => x.type === 'spontaneous' || x.type === 'prepared');
  return Object.fromEntries(Object.entries(e?.slots ?? {}).map(([r, p]) => [r, p.max]));
};

describe('THE BUG: Advanced Domain granted the initial spell as well as the advanced one', () => {
  const ad = db.feats['advanced-domain'];
  /*
   * Asked through `grantPicker` rather than off `effectChoices` directly. The invariant is ONE picker,
   * offering the ADVANCED domain spells — answering two of them handed a cleric pushing-gust AND
   * disperse-into-air. WHICH lane holds it is a separate decision: Advanced Domain is `maxTakable:
   * null`, and an `effectChoices` answer is stored once per RECORD, so a repeatable record's pick has
   * to sit on the per-taking `choice`. It moved there; the invariant did not change.
   */
  const ec = grantPicker(ad)! as { id?: string; options: { value: string; grant?: { focusSpells?: string[] } }[] };
  const opt = ec.options.find((o) => o.grant)!;

  it('there is exactly ONE picker, and it offers the advanced domain spells', () => {
    expect(ec, 'a grant-bearing picker must exist').toBeTruthy();
    expect(ad.effectChoices?.length ?? 0, 'no second picker left on the other lane').toBe(0);
    expect(ec.options.length).toBeGreaterThan(30);
  });

  it('a cleric taking it gains exactly ONE focus spell', () => {
    const c = build('cleric', 12, {
      featPicks: { '12:class': 'advanced-domain' },
      featChoices: { '12:class': opt.value },
    } as Partial<BuildState>);
    const granted = opt.grant!.focusSpells!;
    for (const s of granted) expect(focusSpells(c)).toContain(s);
    // …and not the initial spell of the same domain.
    expect(focusSpells(c).filter((s) => !granted.includes(s))).toEqual([]);
  });

  it('Domain Fluency got the same picker WITHOUT inheriting the bug', () => {
    expect(db.feats['domain-fluency'].choice ?? null).toBeNull();
    expect(db.feats['domain-fluency'].effectChoices?.[0]?.options?.length).toBeGreaterThan(30);
    expect(db.feats['domain-fluency'].effectChoices?.[0]?.prompt).toMatch(/advanced/i);
  });
});

describe('spell-list widening', () => {
  it('every named spell resolves — a grant pointing at nothing is worse than none', () => {
    for (const id of ['future-spell-learning', 'sacred-spells']) {
      const spells = db.feats[id].spellListAdditions as { spells: string[] };
      expect(spells.spells.length).toBeGreaterThan(3);
      for (const s of spells.spells) expect(db.spells[s], `${id} → ${s}`).toBeTruthy();
    }
  });

  it('Future Spell Learning reaches the built character', () => {
    const c = build('sorcerer', 10, { featPicks: { '8:class': 'future-spell-learning' } } as Partial<BuildState>);
    expect(c.feats.some((f) => f.featId === 'future-spell-learning')).toBe(true);
    expect(c.spellListAdditions?.['*']).toContain('haste');
    expect(c.spellListAdditions?.['*']).toContain('loose-times-arrow');
  });

  it('and nothing is added without the feat', () => {
    expect(build('sorcerer', 10).spellListAdditions).toBeUndefined();
  });

  it("Sacred Spells' benefit picker is re-authored so it survives a data rebuild", () => {
    const backfill = JSON.parse(readFileSync('scripts/data/effect-backfill.json', 'utf8')) as {
      category: string;
      id: string;
      field: string;
    }[];
    expect(backfill.some((e) => e.id === 'sacred-spells' && e.field === 'choice')).toBe(true);
  });
});

describe('extra spell slots', () => {
  // Conscious Spell Specialization used to be asserted HERE as an ordinary slot grant, which is what
  // it shipped as: four plain slots plus a warning that the app does not police the restriction. That
  // over-grants, and "you can use these spell slots to cast only a spell granted by your conscious
  // mind" is the whole feat. It is now a RESTRICTED grant, exercised in test/restricted-slots.test.ts.
  // What still belongs here is the other half of the claim: it must not touch the ordinary pool.
  it('Conscious Spell Specialization leaves the psychic’s own slots alone', () => {
    const base = mainSlots(build('psychic', 14));
    const withIt = mainSlots(build('psychic', 14, { featPicks: { '14:class': 'conscious-spell-specialization' } } as Partial<BuildState>));
    for (const r of ['1', '2', '3', '4', '5', '6', '7']) expect(withIt[r], `rank ${r} must be untouched`).toBe(base[r]);
  });

  it('…and its restricted grant still carries the 18th-level step its text names', () => {
    const f = db.feats['conscious-spell-specialization'];
    expect(f.description).toMatch(/At 18th level/i);
    expect(f.spellSlotBonus?.restricted?.byRankAt).toEqual([{ level: 18, byRank: { 5: 1 } }]);
    expect(f.spellSlotBonus?.restricted?.from).toBe('subclass-granted');
  });

  it('the restriction is ENFORCED now, not merely announced', () => {
    // This used to assert a dataWarning saying the app could not restrict the slots — correct when it
    // was written, and false once the restricted-slot lane was built for exactly this feat. A warning
    // that outlives its cause shows the player a "Missing data" banner about something that works.
    const b = db.feats['conscious-spell-specialization'].spellSlotBonus as Record<string, unknown>;
    expect((b.restricted as Record<string, unknown>)?.from).toBe('subclass-granted');
    // `restriction` is the DISPLAY-only string; writing one nothing reads is how a fix becomes a lie.
    expect(b.restriction).toBeUndefined();
    expect(db.feats['conscious-spell-specialization'].dataWarning).toBeUndefined();
  });

  it('Captivating Intensity is NOT a slot grant — it is innate USES', () => {
    // "You can cast each occult INNATE SPELL granted by captivator archetype feats one additional
    // time per day." A spellSlotBonus here would invent slots the archetype never had: the captivator
    // grants innate spells at fixed levels, not a slot ladder.
    expect(db.feats['captivating-intensity'].description).toMatch(/innate spell/i);
    expect(db.feats['captivating-intensity'].spellSlotBonus).toBeUndefined();
    // Those extra uses now show on the sheet (see test/captivator-archetype.test.ts), so what remains
    // is a NOTE about the one clause still untracked — not a warning that the feat does nothing.
    expect(db.feats['captivating-intensity'].dataWarning).toBeUndefined();
    expect(db.feats['captivating-intensity'].note).toMatch(/2\/day/);
  });
});

describe('Draconic Paragon', () => {
  it("adds deadly d6 to the draconic unarmed strikes it names", () => {
    expect(db.feats['draconic-paragon'].unarmedTraits).toEqual({ match: ['jaw', 'claw', 'tail'], add: ['deadly-d6'] });
  });
});
