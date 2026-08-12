// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { renderText } from './_render';
import { SpellsTab } from '../src/sheet/SpellsTab';
import { spellNotesFor } from '../src/rules/explain';
import type { SpellNote } from '../src/rules/types';

/**
 * N2 — a record that modifies a spell it grants writes its text INTO that spell's description,
 * attributed to the record and set apart from the spell's own printed rules.
 *
 * Realm Strider is the owner's worked example: Translocate as printed says nothing about every cast
 * filling the adjacent spaces with your realm's damage type, so a player reading the spell met none
 * of it. The two failure modes this guards are opposite — the clause never reaching the spell, and
 * the clause reaching everyone who reads the spell.
 */
const c = () => content();
const noop = () => undefined;

/** The Realm Strider clause, or a fragment of it that is unmistakably not Translocate's own text. */
const REALM = "your realm's damage type";

describe('a record writes a note onto a spell it grants', () => {
  it("Realm Strider's clause reaches Translocate, under the feat's name", () => {
    const ch = build('fighter', 16, { featPicks: { '16:class': 'realm-strider' } });
    const notes = spellNotesFor(ch, 'translocate');
    expect(notes).toHaveLength(1);
    expect(notes[0].from).toBe('Realm Strider');
    expect(notes[0].note).toContain(REALM);
  });

  it('is never folded into the spell record, which every other character also reads', () => {
    // The reason the lane exists at all. A clause merged into Translocate's own description would be
    // true of every caster in the game, and there would be no way to take it back out.
    expect(c().spells.translocate.description).not.toContain(REALM);
    expect((c().spells.translocate as { spellNotes?: SpellNote[] }).spellNotes).toBeUndefined();
  });

  it('shows nothing to a character who does not have the record', () => {
    const ch = build('fighter', 16);
    expect(spellNotesFor(ch, 'translocate')).toEqual([]);
    expect(ch.spellNotes).toBeUndefined();
  });

  it('does not leak onto the other spells the same character has', () => {
    const ch = build('fighter', 16, { featPicks: { '16:class': 'realm-strider' } });
    expect(spellNotesFor(ch, 'heal')).toEqual([]);
    expect(Object.keys(ch.spellNotes ?? {})).toEqual(['translocate']);
  });

  it('carries a note from a BACKGROUND, not only from a feat', () => {
    // The lane is general on purpose — Blight Survivor's Cleanse Affliction rider is authored on a
    // background, which is a different shape from Feat and would need its own walk otherwise.
    const ch = build('fighter', 4, { backgroundId: 'blight-survivor' });
    const notes = spellNotesFor(ch, 'cleanse-affliction');
    expect(notes).toHaveLength(1);
    expect(notes[0].from).toBe('Blight Survivor');
    expect(notes[0].note).toContain('fungus');
  });
});

describe('the authored notes', () => {
  it('only ever name a spell that ships AND that the record actually grants', () => {
    // A note on a spell the record does not grant would print on a page the feat has no business
    // touching; a note on a spell that does not ship prints nowhere at all.
    const db = c() as unknown as Record<string, Record<string, Record<string, unknown>>>;
    const bad: string[] = [];
    for (const collection of ['feats', 'classFeatures', 'heritages', 'ancestries', 'backgrounds', 'items']) {
      for (const [id, rec] of Object.entries(db[collection] ?? {})) {
        const notes = rec.spellNotes as SpellNote[] | undefined;
        if (!notes?.length) continue;
        const granted = new Set<string>();
        for (const s of (rec.innateSpells as { spellId?: string }[] | undefined) ?? []) if (s?.spellId) granted.add(s.spellId);
        for (const s of (rec.focusSpells as (string | { spellId?: string })[] | undefined) ?? [])
          granted.add(typeof s === 'string' ? s : (s?.spellId ?? ''));
        for (const s of (rec.spells as (string | { spellId?: string })[] | undefined) ?? [])
          granted.add(typeof s === 'string' ? s : (s?.spellId ?? ''));
        // A spell put into a REPERTOIRE or a FONT is granted just as surely as an innate one — that is
        // how Vellumis Excision gives Field of Life ("as a 6th-rank halcyon spell"), which spent a
        // while filed as an innate 1/day instead. `as: 'list'` is deliberately NOT counted: it only
        // widens what the player MAY learn, so a clause about a spell they may never take is premature.
        const additions = rec.spellListAdditions as { spells?: string[]; as?: string } | { spells?: string[]; as?: string }[] | undefined;
        for (const add of additions == null ? [] : Array.isArray(additions) ? additions : [additions])
          if (add.as === 'repertoire' || add.as === 'font') for (const s of add.spells ?? []) granted.add(s);
        for (const n of notes) {
          if (!c().spells[n.spellId]) bad.push(`${collection}/${id} → missing spell ${n.spellId}`);
          else if (!granted.has(n.spellId)) bad.push(`${collection}/${id} → does not grant ${n.spellId}`);
          if (!n.note?.trim()) bad.push(`${collection}/${id} → empty note on ${n.spellId}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('the spell popup prints the note after the spell, under the record that wrote it', () => {
  it("Translocate's popup carries Realm Strider's clause, attributed and last", () => {
    const ch = build('fighter', 16, { featPicks: { '16:class': 'realm-strider' } });
    const text = renderText(<SpellsTab character={ch} content={c()} onPlay={noop} />, ['Translocate']);
    expect(text).toContain(REALM);
    // Attributed, and AFTER the spell's own rules — the whole point of the ruling is that the player
    // can tell which half of what they are reading is Translocate and which half is their feat. The
    // LAST "Realm Strider" is the one in the popup; the first is the innate entry's header on the page
    // behind it.
    const own = text.indexOf('You instantly transport yourself');
    const attribution = text.lastIndexOf('Realm Strider');
    expect(own).toBeGreaterThan(-1);
    expect(attribution).toBeGreaterThan(own);
    expect(text.indexOf(REALM)).toBeGreaterThan(attribution);
  });

  it('the same popup shows a character without the feat only the spell', () => {
    const ch = build('fighter', 16, { overrides: { addedSpells: [{ spellId: 'translocate' }] } });
    const text = renderText(<SpellsTab character={ch} content={c()} onPlay={noop} />, ['Translocate']);
    expect(text).toContain('You instantly transport yourself');
    expect(text).not.toContain(REALM);
    expect(text).not.toContain('Realm Strider');
  });
});
