// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { renderText } from './_render';
import { CompanionsTab } from '../src/sheet/CompanionsTab';
import { deriveFamiliar } from '../src/rules/companions';
import { CREATURE_OFFERS, offeredCreatures, featGrantedCompanions } from '../src/rules/companionGrants';
import { applyPlayState, initialPlay } from '../src/rules/play';
import type { Character, CompanionConfig } from '../src/rules/types';

/**
 * A TEMPORARY CREATURE THE PLAYER ADDS (owner principle M2).
 *
 * Out of Hand's severed arm is not a companion the feat gives you — it exists only once you have torn
 * the limb off at the table, and it stops existing when you reattach it. So taking the feat must add
 * the CAPABILITY and nothing else: a row in the Add-companion picker the player presses when it
 * happens. Every assertion below is paired with the wrong answer it must not produce — a card that
 * appeared on its own, a familiar's 25-foot Speed, an ability the arm cannot have.
 */
const db = content();
const noop = () => undefined;

const withFeat = (ch: Character, featId: string): Character => ({
  ...ch,
  feats: [...ch.feats, { featId, level: 8, slot: `offer:${featId}` }],
});
const live = (ch: Character) => applyPlayState(ch, initialPlay(ch, db), db);
/** A character at the feat's own level, holding the feat and (optionally) the creature they added. */
const player = (featIds: string[], companions: CompanionConfig[] = []) =>
  live(featIds.reduce(withFeat, build('fighter', 8, { companions })));

const ARM: CompanionConfig = { id: 'c1', kind: 'familiar', name: '', offerSlug: 'out-of-hand' };

describe('the record OFFERS the creature — it never adds one', () => {
  it('taking Out of Hand puts no companion on the sheet', () => {
    // The grant lane would have made a card appear the moment the feat was taken. That is exactly the
    // behaviour the owner ruled out: "the user will add it when it happens in game".
    expect(featGrantedCompanions(new Set(['out-of-hand']))).toEqual([]);
    const text = renderText(<CompanionsTab character={player(['out-of-hand'])} content={db} onPlay={noop} charKey="t" />);
    expect(text).toContain('No companions');
    expect(text).not.toContain('Severed Arm');
  });

  it('the offer is open only to a character whose record offers it', () => {
    const got = offeredCreatures(new Set(['out-of-hand']));
    expect(got).toHaveLength(1);
    expect(got[0].offerSlug).toBe('out-of-hand');
    expect(got[0].offer.name).toBe('Severed Arm');
    expect(offeredCreatures(new Set(['pet', 'toughness', 'zombie-dedication']))).toEqual([]);
  });

  it('every offer names a record that ships, and calls it what the record calls itself', () => {
    for (const [slug, offer] of Object.entries(CREATURE_OFFERS)) {
      const rec = db.feats[slug] ?? db.classFeatures[slug];
      expect(rec, `${slug} must name a shipped record`).toBeTruthy();
      expect(offer.from, slug).toBe(rec.name);
    }
  });
});

describe("the severed arm's stat block is a familiar's, with the feat's overrides", () => {
  const plain = () => deriveFamiliar({ id: 'c1', kind: 'familiar', name: '' }, player([]), db);

  it('its Speed is the printed 5 feet, not a familiar’s 25', () => {
    const b = deriveFamiliar(ARM, player(['out-of-hand']), db);
    expect(b.speed).toBe(5);
    expect(b.speed, "the familiar's own Speed must not survive the override").not.toBe(plain().speed);
  });

  it('it has its own Hit Points — the familiar 5 per level, which Lay Down Arms reads', () => {
    const b = deriveFamiliar(ARM, player(['out-of-hand']), db);
    expect(b.hp).toBe(40);
    expect(b.hp).toBe(plain().hp);
  });

  it('it uses your AC, saves and Perception, exactly as a familiar does', () => {
    const b = deriveFamiliar(ARM, player(['out-of-hand']), db);
    const p = plain();
    expect(b.ac).toBe(p.ac);
    expect(b.saves).toEqual(p.saves);
    expect(b.perception).toBe(p.perception);
  });

  it('it has NO familiar or master abilities — not chosen ones, and not ones a feat grants', () => {
    // Tough would raise its HP to 7/level and Flier would give it a fly Speed; Lightning Rings
    // Intervention grants an ability unasked. "Without any familiar or master abilities" means all of
    // those are wrong answers, not just the picker being empty.
    const cfg: CompanionConfig = { ...ARM, abilities: ['tough', 'flier'] };
    const b = deriveFamiliar(cfg, player(['out-of-hand', 'lightning-rings-intervention']), db);
    expect(b.abilities).toEqual([]);
    expect(b.hp, 'Tough must not raise a severed limb’s HP').toBe(40);
    expect(b.extraSpeeds, 'Flier must not give it a fly Speed').toEqual([]);
  });

  it('it is named for the offer until the player renames it', () => {
    expect(deriveFamiliar(ARM, player(['out-of-hand']), db).name).toBe('Severed Arm');
    expect(deriveFamiliar({ ...ARM, name: 'Left Hand' }, player(['out-of-hand']), db).name).toBe('Left Hand');
  });

  it('an ordinary familiar is untouched by the lane', () => {
    const b = deriveFamiliar({ id: 'c1', kind: 'familiar', name: '', abilities: ['tough', 'flier'] }, player([]), db);
    expect(b.offer).toBeUndefined();
    expect(b.speed).toBe(25);
    expect(b.hp).toBe(56);
    expect(b.extraSpeeds).toContain('fly 25 feet');
  });
});

describe('the card prints the rules the numbers cannot express', () => {
  const text = () =>
    renderText(<CompanionsTab character={player(['out-of-hand'], [ARM])} content={db} onPlay={noop} charKey="t" />);

  it('shows it as a minion of the feat, with its Speed and its trackable HP', () => {
    const t = text();
    expect(t).toContain('Severed Arm');
    expect(t).toContain('Minion');
    expect(t).toContain('Out of Hand');
    expect(t).toContain('5 feet');
    expect(t).toContain('/ 40'); // the HP tracker's max, beside the editable current
  });

  it('the switcher and the header name it, rather than calling it a second Familiar', () => {
    const t = text();
    expect(t).toContain('Severed Arm · Level 8');
    expect(t, 'the shape it borrows its statistics from is not its name').not.toContain('Familiar · Level 8');
  });

  it('carries the tether, the inert clause, and whose attack bonus its Strikes use', () => {
    const t = text();
    expect(t).toContain('100 feet');
    expect(t).toContain('inert until reattached');
    expect(t).toMatch(/YOUR attack bonus and damage/);
    expect(t).toContain('10 minutes');
  });

  it('says the arm HAS no abilities instead of showing an unanswered choice', () => {
    const t = text();
    expect(t).toContain('no familiar or master abilities');
    expect(t, 'a severed limb has no ability slots to fill').not.toContain('None chosen yet');
  });

  it('says the player put it there and the player takes it away', () => {
    expect(text()).toContain('You added this from Out of Hand');
    // Not the grant lane's wording — nothing granted this.
    expect(text()).not.toContain('Granted by a feat');
  });
});

describe('the Add-companion picker is where the capability lives', () => {
  it('offers the arm to a character with the feat', () => {
    const t = renderText(
      <CompanionsTab character={player(['out-of-hand'])} content={db} onPlay={noop} charKey="t" />,
      ['Add companion'],
    );
    expect(t).toContain('Severed Arm');
    expect(t).toContain('From your feats');
  });

  it('offers it to nobody else, and hides the category entirely', () => {
    const t = renderText(<CompanionsTab character={player([])} content={db} onPlay={noop} charKey="t" />, ['Add companion']);
    expect(t).not.toContain('Severed Arm');
    expect(t).not.toContain('From your feats');
    // …while still being the ordinary picker.
    expect(t).toContain('Familiar (generic)');
  });
});
