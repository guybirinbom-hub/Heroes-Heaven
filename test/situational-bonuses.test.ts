import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { explainStat, statHasSituational } from '../src/rules/explain';
import { featSituationalFor, hasFeatSituational, FEAT_SITUATIONAL } from '../src/rules/situationalBonuses';
import type { Character } from '../src/rules/types';

describe('feat situational bonuses', () => {
  const c = content();

  it('every registry key is a plain slug', () => {
    // A generated key once arrived as "items/kraken-figurehead", and another as a COMMA-SEPARATED
    // list of four ids in one key. The obvious dead-id scan uses /[a-z0-9-]+/, which does not flag
    // those — it skips them, so they shipped silently and the scan reported zero problems. Assert the
    // SHAPE of the key, not just that it resolves.
    // `trait:<name>` is the one legal prefix — armour/shield traits are not records, so they cannot be
    // keyed by a record id, and the namespace stops them ever colliding with one.
    const bad = Object.keys(FEAT_SITUATIONAL).filter((k) => !/^(trait:)?[a-z0-9-]+$/.test(k));
    expect(bad, `malformed registry keys: ${bad.join(' | ')}`).toHaveLength(0);
  });

  it('every trait-keyed entry names a trait that actually ships on an item', () => {
    // The same protection the dead-id scan gives record keys. A typo'd trait would be silently inert,
    // which is precisely the failure this lane exists to fix.
    const shipped = new Set<string>();
    for (const i of Object.values(c.items)) {
      if (i.itemType === 'armor' || i.itemType === 'shield') for (const t of i.traits ?? []) shipped.add(t);
    }
    const traitKeys = Object.keys(FEAT_SITUATIONAL).filter((k) => k.startsWith('trait:'));
    expect(traitKeys.length).toBeGreaterThan(0);
    const dead = traitKeys.filter((k) => !shipped.has(k.slice('trait:'.length)));
    expect(dead, `trait entries matching no shipped armour/shield trait: ${dead.join(', ')}`).toHaveLength(0);
  });

  it('the registry is populated and well-formed', () => {
    const ids = Object.keys(FEAT_SITUATIONAL);
    expect(ids.length).toBeGreaterThan(200);
    // The table is named FEAT_SITUATIONAL for history, but a conditional bonus comes from an ITEM
    // (Coral Aspect), a heritage, a background or a class feature just as often as from a feat — and
    // since the reach fix all of those raise the star. So an id must resolve in SOME collection;
    // the old feats-only assertion would now reject correct data.
    // Companion buckets are included because records like `aon-vulture` (an animal companion) and
    // `steadfast-strider` (a companion specialization) legitimately carry conditional bonuses. Note
    // those bonuses apply to the COMPANION, not the PC, so they correctly do not raise a star on the
    // player's own rows — characterSituationalIds does not walk companions.
    const cols: (Record<string, unknown> | undefined)[] = [
      c.feats, c.items, c.heritages, c.backgrounds, c.classFeatures, c.ancestries,
      c.animalCompanions, c.companionSpecializations,
    ];
    // `trait:` keys are checked by their own test above — they name an armour trait, not a record.
    const dead = ids.filter((id) => !id.startsWith('trait:') && !cols.some((col) => col && col[id]));
    expect(dead, `registry ids matching no record: ${dead.slice(0, 8).join(', ')}`).toHaveLength(0);
    for (const id of ids) {
      for (const b of FEAT_SITUATIONAL[id]) {
        expect(b.targets.length, id).toBeGreaterThan(0);
        expect(b.when.length, id).toBeGreaterThan(0);
        expect(b.bonus.length, id).toBeGreaterThan(0);
      }
    }
  });

  it('Intimidating Prowess flags Intimidation and lists its condition', () => {
    expect(featSituationalFor(['intimidating-prowess'], { kind: 'skill', skill: 'intimidation' })).toHaveLength(1);
    // …but not other skills.
    expect(featSituationalFor(['intimidating-prowess'], { kind: 'skill', skill: 'stealth' })).toHaveLength(0);
    expect(hasFeatSituational(['intimidating-prowess'], { kind: 'skill', skill: 'intimidation' })).toBe(true);
  });

  it("a save 'all' entry matches every save; a specific one matches only itself", () => {
    // adhyabhau: Will only. affliction-resistance / bloodline-resistance: all saves.
    expect(hasFeatSituational(['adhyabhau'], { kind: 'save', save: 'will' })).toBe(true);
    expect(hasFeatSituational(['adhyabhau'], { kind: 'save', save: 'reflex' })).toBe(false);
    expect(hasFeatSituational(['bloodline-resistance'], { kind: 'save', save: 'reflex' })).toBe(true);
    expect(hasFeatSituational(['bloodline-resistance'], { kind: 'save', save: 'fortitude' })).toBe(true);
  });

  it('surfaces in the stat breakdown and drives the star', () => {
    // Give a rogue Intimidating Prowess (it's a skill feat).
    const ch = build('rogue', 4, { featPicks: { '2:skill:0': 'intimidating-prowess' } as never });
    expect(ch.feats.some((f) => f.featId === 'intimidating-prowess')).toBe(true);

    const b = explainStat(ch, c, { kind: 'skill', skill: 'intimidation' });
    expect(b.situational?.some((s) => /Intimidating Prowess/.test(s.text) && /Coerce or Demoralize/.test(s.text))).toBe(true);
    expect(statHasSituational(ch, { kind: 'skill', skill: 'intimidation' })).toBe(true);
    // a skill the feat doesn't touch has no star
    expect(statHasSituational(ch, { kind: 'skill', skill: 'stealth' })).toBe(false);
  });

  it('a character without the feat gets no star and no note', () => {
    const ch = build('rogue', 4);
    expect(statHasSituational(ch, { kind: 'skill', skill: 'intimidation' })).toBe(false);
    const b = explainStat(ch, c, { kind: 'skill', skill: 'intimidation' });
    expect(b.situational?.some((s) => /Intimidating Prowess/.test(s.text)) ?? false).toBe(false);
  });
});

/**
 * batch-001, the star-authoring half. Each of these records printed a rule the sheet never showed,
 * and each has a shipped reader — nothing new was built for them.
 */
describe('batch-001 — the rows the lane was waiting for', () => {
  const c = content();
  const withFeat = (id: string, level = 3) => {
    const base = build('fighter', level);
    return { ...base, feats: [...base.feats, { featId: id, source: 'test', level: 1 }] } as Character;
  };

  it('Alghollthu Bound shows the penalty as well as the bonus, and neither leaks off Will', () => {
    /*
     * The record shipped the +2 alone. Its own text takes it back against alghollthus and hands you a
     * -2 there instead — the Dragon's Presence shape, good news shown and bad news hidden.
     *
     * R1 keeps BOTH on Will: an unqualified follow-on clause takes the scope of the sentence that
     * governs it, and "none of these benefits … and instead" binds the penalty to the row the
     * benefits sat on. ⚠ This overrides the batch-001 finding, which asked for the -2 on all three.
     */
    const ch = withFeat('alghollthu-bound');
    const lines = (explainStat(ch, c, { kind: 'save', save: 'will' }).situational ?? []).map((s) => s.text);
    expect(lines.some((t) => /\+2 circumstance/.test(t) && /unless the effect originates from an alghollthu/.test(t))).toBe(true);
    expect(lines.some((t) => /-2 circumstance/.test(t) && /from alghollthus/.test(t))).toBe(true);
    expect(statHasSituational(ch, { kind: 'save', save: 'reflex' }, c)).toBe(false);
    expect(statHasSituational(ch, { kind: 'save', save: 'fortitude' }, c)).toBe(false);
  });

  it('Armor Assist stars the Lore it names and no other', () => {
    // "an Athletics or Warfare Lore check" — ruling C stars every skill that can make the named
    // check, and the Lore key is EXACT: a bare `lore` target is read as every `lore:*` row.
    const ch = withFeat('armor-assist');
    expect(statHasSituational(ch, { kind: 'skill', skill: 'athletics' }, c)).toBe(true);
    expect(statHasSituational(ch, { kind: 'skill', skill: 'lore:Warfare' }, c)).toBe(true);
    expect(statHasSituational(ch, { kind: 'skill', skill: 'lore:Sailing' }, c)).toBe(false);
  });

  it('both duplicate imports of the regiment feat star Speed, and only travel Speed', () => {
    // `armor-regiment-training` and `armored-regiment-training` are the same Battlecry! feat imported
    // twice and BOTH are offered by the class-feat picker, so a row on one alone reaches half the
    // characters that take it.
    for (const id of ['armor-regiment-training', 'armored-regiment-training']) {
      const ch = withFeat(id);
      expect(statHasSituational(ch, { kind: 'speed' }, c), `${id} does not star Speed`).toBe(true);
      const line = (explainStat(ch, c, { kind: 'speed' }).situational ?? []).find((s) => s.sourceId === id);
      expect(line, `${id} has no Speed line`).toBeDefined();
      // The printed clause is exploration-mode travel Speed only; stripping the penalty from the
      // encounter Speed printed on the sheet would be a different (and wrong) mechanic.
      expect(line!.text).toMatch(/travel Speed in exploration mode/);
      expect(line!.text).toMatch(/not your encounter Speed/);
    }
  });

  it('the other four stars land on the statistic the clause names', () => {
    expect(statHasSituational(withFeat('all-of-the-animal'), { kind: 'skill', skill: 'survival' }, c)).toBe(true);
    expect(statHasSituational(withFeat('bargain-hunter'), { kind: 'skill', skill: 'diplomacy' }, c)).toBe(true);
    expect(statHasSituational(withFeat('blowgun-poisoner'), { kind: 'skill', skill: 'stealth' }, c)).toBe(true);
    // Acrobatic Performer's Performance star comes from `skillSubstitutions`, not this registry: a
    // CONDITIONAL substitution stars `forSkill` without moving its number.
    expect(statHasSituational(withFeat('acrobatic-performer'), { kind: 'skill', skill: 'performance' }, c)).toBe(true);
    const line = (explainStat(withFeat('acrobatic-performer'), c, { kind: 'skill', skill: 'performance' }).situational ?? [])
      .find((s) => s.sourceId === 'acrobatic-performer');
    expect(line?.text).toMatch(/roll acrobatics instead/);
  });

  it('a conditional substitution never MOVES the number it stars', () => {
    // `skillSubstituteFor` (derive.ts) skips any substitution carrying a `when`. Without that, an
    // acrobat with 0 Performance training would silently roll their Acrobatics modifier for every
    // Performance check, not just Perform.
    const base = build('fighter', 3);
    const withIt = withFeat('acrobatic-performer');
    const perf = (ch: Character) => explainStat(ch, c, { kind: 'skill', skill: 'performance' }).totalText;
    expect(perf(withIt)).toBe(perf(base));
  });

  it('no strike star carries a note long enough to wrap (ruling H)', () => {
    // `scripts/cap-situational-notes.mjs` trims an over-long `when` and NOTHING trims a `bonus`, so a
    // 141-character bonus renders as a paragraph inside a list item for ever. Blowgun Poisoner's two
    // strike clauses are two entries for exactly this reason.
    const entries = FEAT_SITUATIONAL['blowgun-poisoner'];
    expect(entries.length).toBe(3);
    for (const e of entries) {
      expect(e.bonus.length, `bonus too long to be one line: ${e.bonus}`).toBeLessThanOrEqual(120);
      expect(e.when!.length, `when too long: ${e.when}`).toBeLessThanOrEqual(120);
    }
  });
});
