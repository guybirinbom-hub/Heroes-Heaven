// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { renderText } from './_render';
import { SpellsTab } from '../src/sheet/SpellsTab';
import { spellNotesFor } from '../src/rules/explain';
import { FEAT_CANTRIP_GRANTS } from '../src/rules/featCantripGrants';
import type { SpellNote } from '../src/rules/types';
import { readFileSync } from 'node:fs';

/** Prose lives in core-descriptions.json since the core.json split; the guard below reads a record's
 *  own printed text to decide whether a note about a spell it does not grant is legitimate. */
const descs = JSON.parse(readFileSync('public/core-descriptions.json', 'utf8').replace(/^﻿/, '')) as Record<
  string,
  Record<string, { d?: string }>
>;

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

/*
 * …OR A SPELL THE PROSE NAMES BY OTHER MEANS. The substring test below cannot see two legitimate
 * naming shapes, so each entry here must quote the prose phrase that does the naming:
 *  - a PRE-REMASTER name: Disk Rider's text reads "When you cast Floating Disk…", and the app ships
 *    that spell's remaster identity, `carryall`. (REMASTER_RENAME in scripts/lib/edition.mjs maps
 *    rules TERMS, not spell names, so there is no table to consult instead.)
 *  - a named SET: Folding Drums' text reads "a composition cantrip that has an emanation", and the
 *    notes enumerate that set's shipped members — verified against the spell list when authored.
 * A note about a spell the record never mentions in ANY form stays caught.
 */
const NAMED_BY_OTHER_MEANS: Record<string, string[]> = {
  'feats/disk-rider': ['carryall'],
  'items/folding-drums': ['courageous-anthem', 'rallying-anthem', 'song-of-marching', 'song-of-strength', 'triple-time', 'silvers-refrain', 'dirge-of-doom'],
};

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
          // A PICK-DRIVEN clause names no spell, and must not: Awakened Jewel's "as long as you possess
          // your head gem" is about whichever of its 34 cantrips the player chose, so any spellId here
          // would be a lie about the other 33. It attaches to the answer instead (build.ts, the
          // `fromCantripPick` loop). What it still has to have is a pick to attach to — a note on a
          // record that asks nothing renders nowhere at all — so the picker registry is the assertion.
          if (n.fromCantripPick) {
            if (n.spellId) bad.push(`${collection}/${id} → fromCantripPick note also names ${n.spellId}, which is ignored`);
            if (!FEAT_CANTRIP_GRANTS[id]) bad.push(`${collection}/${id} → fromCantripPick note on a record with no cantrip picker`);
            if (!n.note?.trim()) bad.push(`${collection}/${id} → empty fromCantripPick note`);
            continue;
          }
          // A SOURCE-DRIVEN clause names no spell either, and for a stronger reason than the pick:
          // Ancestral Blood Magic's set is "every non-cantrip spell you gained from a heritage or an
          // ancestry feat", which is a property of the CHARACTER — 252 ancestry-feat grants qualify and
          // which of them any given sorcerer has is not knowable here. It attaches in build.ts's
          // `wantsAncestrySpellNote` pass. There is no registry to point at (that is the whole reason
          // the shape exists), so what is asserted is that it names no spell and says something.
          if (n.fromAncestrySpells) {
            if (n.spellId) bad.push(`${collection}/${id} → fromAncestrySpells note also names ${n.spellId}, which is ignored`);
            if (!n.note?.trim()) bad.push(`${collection}/${id} → empty fromAncestrySpells note`);
            continue;
          }
          const spell = c().spells[n.spellId as string] as { traits?: string[] } | undefined;
          /*
           * …OR A SPELL OF THE RECORD'S OWN CLASS, which the class grants even though no RECORD says
           * so. Mercy and Cruelty are the case: both are champion feats whose whole content is a
           * clause about the champion's devotion spell (*"You can cast lay on hands … using 2 actions
           * instead of 1"*), and the devotion spell is handed out by a build-time lane —
           * `championDevotionSpell` in build.ts, font-gated on the deity — not by a record this static
           * walk can see. Read literally, the guard called a champion feat's note about a champion
           * spell "a page the feat has no business touching".
           *
           * The exemption is narrow on purpose: the spell must carry the SAME class trait the record
           * does. A champion feat may comment on a champion spell; it still may not comment on a
           * wizard's.
           */
          const sharedClass = (spell?.traits ?? []).some((t) => ((rec.traits as string[]) ?? []).includes(t));
          /*
           * …OR A SPELL THE RECORD'S OWN PRINTED TEXT NAMES. Overwhelming Harm is the case:
           * *"Whenever you cast the 3-action version of HARM, you can extend the area to a 60-foot
           * emanation."* The clause is entirely about that spell, but `harm` carries no class trait
           * (manipulate, void) so the class test above cannot reach it, and no record "grants" a
           * necromancer their harm.
           *
           * Still tight: the feat has to SAY the spell's name. A note about a spell the record never
           * mentions is exactly what this guard exists to catch, and remains caught.
           */
          const prose = String(
            (descs[collection] as Record<string, { d?: string }> | undefined)?.[id]?.d ?? '',
          ).toLowerCase();
          const namesIt = !!spell?.name && prose.includes(spell.name.toLowerCase());
          const namedOtherwise = NAMED_BY_OTHER_MEANS[`${collection}/${id}`]?.includes(n.spellId as string) ?? false;
          if (!spell) bad.push(`${collection}/${id} → missing spell ${n.spellId}`);
          else if (!granted.has(n.spellId) && !sharedClass && !namesIt && !namedOtherwise) bad.push(`${collection}/${id} → does not grant ${n.spellId}`);
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
