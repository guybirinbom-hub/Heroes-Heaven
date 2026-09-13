// @vitest-environment jsdom
// bug 2026-09-12 #4: ancestry-boost
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { buildCharacter, emptyBuild, fixedBoosts, type BuildState } from '../src/rules/build';
import type { AbilityId } from '../src/rules/types';

/**
 * "there is a character lv 7 named rux why cant i choose wisdom for the ancestry boost?" — owner,
 * 2026-09-12. Rux is a CATFOLK bard. Catfolk (Player Core 2, and the Advanced Player's Guide before
 * it) boost Dexterity and Charisma, get one free boost, and take a WISDOM FLAW.
 *
 * The builder greyed Wisdom, and `collectBoosts` threw the pick away if it ever got through, because
 * both treated the ancestry's FLAW as part of the boost set. Neither edition's rules say that:
 *
 *   "When you gain multiple attribute boosts at the same time, you must apply each one to a different
 *    modifier. Dwarves, for example, receive an attribute boost to their Constitution modifier and
 *    their Wisdom modifier, as well as one free attribute boost, which can be applied to any OTHER
 *    attribute."                                              — Player Core p.19 (Core Rulebook p.20)
 *
 *   "Attribute flaws are not nearly as common in Pathfinder as attribute boosts. If your character
 *    has an attribute flaw — likely from their ancestry — you decrease that attribute modifier by 1."
 *                                                             — Player Core p.19 (Core Rulebook p.20)
 *
 * The restriction is boost-against-boost, from the same source at the same time. A flaw is not a
 * boost, so the free ancestry boost may go into the flawed attribute (netting back to +0) — and it
 * may NOT go into either attribute the ancestry already boosts. That is the whole rule, and the
 * ONLY exclusion the picker and the engine are allowed to make.
 */
const c = () => content();
const noop = () => undefined;

const rux = (over: Partial<BuildState> = {}): BuildState => ({
  ...emptyBuild(),
  name: 'Rux',
  level: 7,
  ancestryId: 'catfolk',
  heritageId: 'liminal-catfolk',
  backgroundId: 'acolyte',
  classId: 'bard',
  subclassId: 'maestro',
  keyAbility: 'cha',
  ...over,
});

/** Open ancestry-boost pill `slot` on the builder's level-0 page and read every attribute row. */
function ancestryBoostOptions(build: BuildState, slot = 0): { label: string; disabled: boolean; why: string }[] {
  const r = renderDom(<Builder content={c()} initial={build} onCancel={noop} onCreate={noop} />);
  // Editing opens on Setup; the origin page (ancestry, heritage, boosts) is the chip labelled "0".
  const zero = [...r.host.querySelectorAll<HTMLButtonElement>('button.lchip')].find((b) => (b.textContent ?? '').trim() === '0');
  r.click(zero ?? null);
  const card = r.host.querySelector<HTMLElement>('[data-subcard^="Ancestry boost"]');
  expect(card, 'the ancestry-boost sub-card is not on the level-0 page').toBeTruthy();
  const pills = [...card!.querySelectorAll<HTMLButtonElement>('button.popsel')];
  expect(pills.length, `the ancestry-boost card has no slot ${slot}`).toBeGreaterThan(slot);
  r.click(pills[slot]);
  const rows = [...r.host.querySelectorAll<HTMLButtonElement>('.picker-item')].map((el) => ({
    label: (el.querySelector('.picker-name')?.textContent ?? '').trim(),
    disabled: el.disabled,
    why: (el.querySelector('.picker-why')?.textContent ?? '').trim(),
  }));
  r.stop();
  expect(rows.length, 'the attribute picker opened empty').toBeGreaterThan(0);
  return rows;
}
const row = (rows: ReturnType<typeof ancestryBoostOptions>, label: string) => rows.find((o) => o.label === label)!;

describe("Rux's ancestry: catfolk", () => {
  it('is the shape the report describes — Dex + Cha boosts, one free boost, a Wisdom flaw', () => {
    const anc = c().ancestries.catfolk;
    expect(fixedBoosts(anc.abilityBoosts).sort()).toEqual(['cha', 'dex']);
    expect(anc.abilityBoosts.filter((b) => b.kind === 'free')).toHaveLength(1);
    expect(anc.abilityFlaws).toEqual(['wis']);
  });

  it('offers Wisdom for the free ancestry boost', () => {
    // The reported bug, at the pixel. Mutation proof: put `ancAttrs.abilityFlaws` back into the
    // picker's `exclude` and this fails — Wis comes back disabled.
    const wis = row(ancestryBoostOptions(rux()), 'Wis');
    expect(wis, 'Wisdom is not even in the list').toBeTruthy();
    expect(wis.disabled, 'Wisdom is greyed out — the flaw is not part of the boost set').toBe(false);
    expect(wis.why).toBe('');
  });

  it('still refuses the two attributes catfolk already boost, and says why', () => {
    const rows = ancestryBoostOptions(rux());
    for (const label of ['Dex', 'Cha']) {
      expect(row(rows, label).disabled, `${label} is a fixed catfolk boost and must stay greyed`).toBe(true);
      expect(row(rows, label).why).toMatch(/already boosted/i);
    }
    // …and everything the ancestry does not boost stays live.
    for (const label of ['Str', 'Con', 'Int']) expect(row(rows, label).disabled, label).toBe(false);
  });

  it('a second ancestry slot still excludes the first slot’s own pick', () => {
    // The same-source rule that IS real: two boosts from one source cannot share an attribute.
    const rows = ancestryBoostOptions(rux({ ancestryBoosts: ['int'], options: { alternateAncestryBoosts: true } }), 1);
    expect(row(rows, 'Int').disabled).toBe(true);
    expect(row(rows, 'Wis').disabled).toBe(false);
  });

  it('applies the Wisdom boost — it nets the flaw back to +0 instead of being discarded', () => {
    // Mutation proof for the engine half: put the flaw back into `ancTaken` in collectBoosts and the
    // two scores come out equal, because the pick is filtered away before it is ever applied.
    const db = c();
    const none = buildCharacter(rux(), db);
    const boosted = buildCharacter(rux({ ancestryBoosts: ['wis'] }), db);
    expect(none.abilities.wis, 'the flaw alone').toBe(8);
    expect(boosted.abilities.wis, 'flaw −2, free ancestry boost +2').toBe(10);
  });
});

describe('the rule is applied the same way to every ancestry', () => {
  const db = content();
  const flawed = Object.values(db.ancestries).filter((a) => a.abilityFlaws.length > 0 && a.abilityBoosts.some((b) => b.kind === 'free'));
  const boostsWis = Object.values(db.ancestries).filter((a) => fixedBoosts(a.abilityBoosts).includes('wis' as AbilityId));

  it('no ancestry’s flaw is excluded from its own free boost', () => {
    expect(flawed.length, 'fixture check: flawed ancestries with a free boost exist').toBeGreaterThan(0);
    for (const a of flawed) {
      const flaw = a.abilityFlaws[0] as AbilityId;
      if (fixedBoosts(a.abilityBoosts).includes(flaw)) continue; // can't happen in print, but don't assume
      const before = buildCharacter({ ...emptyBuild(), name: 't', level: 1, ancestryId: a.id, classId: 'fighter', keyAbility: 'str' }, db);
      const after = buildCharacter(
        { ...emptyBuild(), name: 't', level: 1, ancestryId: a.id, classId: 'fighter', keyAbility: 'str', ancestryBoosts: [flaw] },
        db,
      );
      expect(after.abilities[flaw] - before.abilities[flaw], `${a.name}: the free boost into its ${flaw} flaw`).toBe(2);
    }
  });

  it('an ancestry that BOOSTS Wisdom still cannot spend its free boost on Wisdom', () => {
    // The other half of the owner's question: where Wisdom really is unavailable, it is unavailable
    // for the printed reason — dwarves boost Constitution and Wisdom, so the free boost is barred.
    expect(boostsWis.map((a) => a.id)).toContain('dwarf');
    for (const a of boostsWis) {
      const base = { ...emptyBuild(), name: 't', level: 1, ancestryId: a.id, classId: 'fighter', keyAbility: 'str' };
      expect(
        buildCharacter({ ...base, ancestryBoosts: ['wis' as AbilityId] }, db).abilities.wis,
        `${a.name}: a free boost repeating a fixed boost must not apply`,
      ).toBe(buildCharacter(base, db).abilities.wis);
    }
  });

  it('the dwarf picker greys Wisdom, and says it is already boosted', () => {
    const rows = ancestryBoostOptions({ ...rux(), ancestryId: 'dwarf', heritageId: null });
    expect(row(rows, 'Wis').disabled).toBe(true);
    expect(row(rows, 'Wis').why).toMatch(/already boosted/i);
    expect(row(rows, 'Cha').disabled, 'the dwarf Charisma flaw is not a boost — it stays live').toBe(false);
  });
});
