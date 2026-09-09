import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { deriveEidolon, LANGUAGE_UNCHOSEN } from '../src/rules/companions';
import { COMPANION_MODS } from '../src/rules/companionGrants';
import { spellOpenedBy } from '../src/sheet/SpellsTab';
import type { CompanionConfig, Spell } from '../src/rules/types';

/*
 * BATCH 033 resume — the eidolon-languages-and-traits group.
 *
 * Two eidolon types whose printed Language line is an ANSWER, not a question (Angel: Celestial, Fey:
 * Sylvan), and the trait half of the fey eidolon's spell-list widening. All three reached the player
 * as description prose only: the eidolon block had no Languages row for a fixed line, and the
 * repertoire picker opened the whole arcane list where print opens the illusion-or-mental slice.
 *
 * Every assertion below runs on a BUILT 5th-level summoner of the type in question.
 */

const eidolonBlock = (typeId: string) => {
  const c = content();
  const ch = build('summoner', 5, { subclassId: typeId });
  const cfg: CompanionConfig = { id: `c-${typeId}`, kind: 'eidolon', name: 'Test Eidolon', typeId, eidolon: {} };
  return deriveEidolon(cfg, ch, c);
};

describe('batch 033 resume — angel-eidolon speaks the language print names', () => {
  // batch 033: angel-eidolon#language
  // AoN eidolon-1, the page this record cites: "**Language** Celestial". (The remaster twin
  // eidolon-15 reads "Language Empyrean" — the same language renamed, not a second one.)
  it('angel-eidolon shows Celestial on the block, with no unanswered pick', () => {
    expect(COMPANION_MODS['angel-eidolon'].languages).toEqual(['Celestial']);
    expect(COMPANION_MODS['angel-eidolon'].languageChoices).toBeUndefined();
    const b = eidolonBlock('angel-eidolon');
    expect(b.languages).toEqual(['Celestial']);
    expect(b.languages).not.toContain(LANGUAGE_UNCHOSEN);
  });
});

describe('batch 033 resume — fey-eidolon speaks the language print names', () => {
  // batch 033: fey-eidolon#language
  // AoN eidolon-8, this record's cited page: "**Language** Sylvan" (remaster twin eidolon-22: Fey).
  it('fey-eidolon shows Sylvan on the block, with no unanswered pick', () => {
    expect(COMPANION_MODS['fey-eidolon'].languages).toEqual(['Sylvan']);
    const b = eidolonBlock('fey-eidolon');
    expect(b.languages).toEqual(['Sylvan']);
    expect(b.languages).not.toContain(LANGUAGE_UNCHOSEN);
  });

  // batch 033: fey-eidolon#language
  // The fixed lane must not turn into a prompt: a type that DOES ask (devotion-phantom-eidolon, one
  // common mortal language) still asks, and a type that neither asks nor is given shows no row.
  it('the fixed lane leaves the fey-eidolon sibling lanes alone', () => {
    expect(eidolonBlock('devotion-phantom-eidolon').languages).toEqual([LANGUAGE_UNCHOSEN]);
    expect(eidolonBlock('beast-eidolon').languages).toBeUndefined();
  });
});

describe('batch 033 resume — dragon-eidolon speaks the language print names', () => {
  // batch 033: dragon-eidolon#language
  // AoN eidolon-7, the page this record cites (and its remaster twin eidolon-21): "Language
  // Draconic". A CONFIRMED finding of this batch that the fixed-language carrier now answers in one
  // word — and the only one of the three whose language our table holds as an ID, so it is also the
  // only cover the `content.languages[...] ?? l` branch of deriveEidolon has: angel and fey both
  // store printed names (no `celestial`/`sylvan` record exists) and never enter it.
  it('dragon-eidolon resolves its fixed language through the id, not the raw token', () => {
    expect(COMPANION_MODS['dragon-eidolon'].languages).toEqual(['draconic']); // the id, not "Draconic"
    expect(content().languages?.['draconic']?.name).toBe('Draconic'); // the harness half
    const b = eidolonBlock('dragon-eidolon');
    expect(b.languages).toEqual(['Draconic']);
    expect(b.languages).not.toContain(LANGUAGE_UNCHOSEN);
  });
});

describe('batch 033 resume — fey-eidolon opens only the slice of arcane print opens', () => {
  // batch 033: fey-eidolon#fey-gift-spells
  // eidolon-8, verbatim: "you can choose from the primal list as well as spells that have the illusion
  // or mental traits that appear on the arcane spell list." (The remaster twin eidolon-22 says "as well
  // as FROM spells that have…" — same clause, and the extra word is why this quote is pinned to its own
  // page.) The row that landed carried the tradition
  // and not the traits, so the picker offered every arcane spell. Fails until the driver applies the
  // re-emitted row — the reader (SpellAccessGrant.traits → build.ts → spellOpenedBy) already ships.
  it('fey-eidolon narrows its arcane widening to illusion or mental', () => {
    const c = content();
    const add = c.classFeatures['fey-eidolon'].spellListAdditions;
    expect(add).toEqual({ traditions: ['arcane'], traits: ['illusion', 'mental'] });

    const ch = build('summoner', 5, { subclassId: 'fey-eidolon' });
    const w = ch.spellListTraditions?.find((x) => x.traditions !== 'any' && x.traditions.includes('arcane'));
    expect(w?.traits).toEqual(['illusion', 'mental']);

    const arcane = (Object.values(c.spells) as Spell[]).filter((s) => s.traditions?.includes('arcane'));
    const illusion = arcane.find((s) => (s.traits ?? []).includes('illusion'));
    const plain = arcane.find((s) => !(s.traits ?? []).some((t) => t === 'illusion' || t === 'mental'));
    expect(illusion && plain).toBeTruthy();                                     // the harness half
    expect(spellOpenedBy(w!, illusion!)).toBe(true);
    expect(spellOpenedBy(w!, plain!)).toBe(false);
  });
});
