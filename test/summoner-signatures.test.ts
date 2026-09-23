import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { signatureSpellsAt } from '../src/rules/build';
import { build, content } from './_content';

/**
 * Summoner — Signature Spells (level 3), the Impossible Magic printing.
 *
 * ⚠ THIS FILE WAS LOOSENED ONCE, AND THAT IS WHY IT PINS THE ID AND THE LEVEL AND THE RULE.
 *
 * A lane moved the summoner's level-3 row to the shared `signature-spells` — the PSYCHIC's page
 * (class-feature-1149) — and deleted the engine branch in the same tree, then rewrote this file to
 * assert only the LEVEL. It passed on either side of the flip, which is the one thing a guard must
 * never do. So all three halves are asserted below: the id the table names, the level it arrives at,
 * and the rule the engine applies.
 *
 * The rule is now the REPRINT, in the record and in the engine together. class-feature-1346
 * ("Signature Spells", Impossible Magic pg. 63, Class Summoner) replaces class-feature-455
 * ("Unlimited Signature Spells", Secrets of Magic): one signature spell per spell rank, the same rule
 * the bard and the sorcerer get, reached through the same `sigAvailable` route in src/rules/build.ts.
 * Before this the record printed the reprint while the engine still granted the legacy rule — the
 * print said LESS than the engine gave.
 *
 * A saved summoner keeps whatever is in `build.signatures`; nothing rewrites it. Older saves hold
 * nothing there (the derived "every spell is signature" meant there was never anything to store), so
 * they come back with an empty signature set and one live star per rank to fill — which is the rule
 * Paizo printed, not a loss of a stored pick.
 */
describe('summoner signature spells', () => {
  it('is the row the class table names at level 3, under the summoner\'s own id', () => {
    const rows = (content().classes.summoner?.features ?? []).filter((f) => f.level === 3);
    expect(rows.map((f) => f.featureId)).toContain('signature-spells-summoner');
    expect(rows.find((f) => f.featureId === 'signature-spells-summoner')?.level).toBe(3);
    // …and NOT the shared record, which is the psychic's page, nor the retired legacy id.
    expect(rows.map((f) => f.featureId)).not.toContain('signature-spells');
    expect(rows.map((f) => f.featureId)).not.toContain('unlimited-signature-spells');
  });

  it('the record is the Impossible Magic page, not the psychic\'s and not the legacy one', () => {
    const rec = content().classFeatures['signature-spells-summoner'];
    expect(rec, 'the summoner needs its own Signature Spells record').toBeTruthy();
    expect(rec.aonId).toBe('class-feature-1346');
    expect(rec.name).toBe('Signature Spells');
    expect(rec.traits).toContain('summoner');
    expect(rec.source?.book).toBe('Pathfinder Impossible Magic');
    /* The Secrets of Magic printing stays in the database as a KEPT ORPHAN on its OWN page — no class
     * table names it, and an Override a player saved against it still resolves — but it no longer
     * wears Impossible Magic's id, name or book, which is what made the record and the engine
     * disagree. Both halves are asserted so neither can drift back. */
    const old = content().classFeatures['unlimited-signature-spells'];
    expect(old?.aonId).toBe('class-feature-455');
    expect(old?.name).toBe('Unlimited Signature Spells');
    expect(old?.source?.book).toBe('Pathfinder Secrets of Magic');
    // …and the psychic's shared record is untouched.
    expect(content().classFeatures['signature-spells']?.aonId).toBe('class-feature-1149');
  });

  it('applies ONE signature per rank from the picks, not the whole repertoire', () => {
    const ch = build('summoner', 5, {
      spells: { 2: ['acid-arrow'], 3: ['agonizing-despair'] },
      signatures: { 2: 'acid-arrow' },
    });
    const entry = ch.spellcasting.find((e) => e.id === 'summoner-casting');
    expect(entry, 'summoner should have a spellcasting entry').toBeTruthy();
    const repertoireSpells = [...new Set(Object.values(entry!.repertoire ?? {}).flat())];
    expect(repertoireSpells.length).toBeGreaterThan(1);
    expect(entry!.signature).toEqual(['acid-arrow']);
    // The rest of the repertoire is NOT signature any more — that was the legacy rule.
    expect(new Set(entry!.signature)).not.toEqual(new Set(repertoireSpells));
  });

  it('does not mark signatures before level 3', () => {
    const ch = build('summoner', 1, { spells: { 1: ['500-toads'] }, signatures: { 1: '500-toads' } });
    const entry = ch.spellcasting.find((e) => e.id === 'summoner-casting');
    expect(entry?.signature ?? []).toEqual([]);
  });

  /**
   * THE OLD-SHAPE SAVE. A summoner saved before the reprint holds no `signatures` block at all, and
   * the picker is what fills it. The character must still build, still hold its whole repertoire, and
   * simply carry no signature until the player picks one — never throw, never lose a known spell.
   */
  it('a save with no `signatures` block still builds and keeps its repertoire', () => {
    const ch = build('summoner', 9, { spells: { 1: ['500-toads'], 4: ['fly'] } });
    const entry = ch.spellcasting.find((e) => e.id === 'summoner-casting');
    const repertoireSpells = [...new Set(Object.values(entry!.repertoire ?? {}).flat())];
    expect(repertoireSpells).toContain('500-toads');
    expect(repertoireSpells).toContain('fly');
    expect(entry!.signature ?? []).toEqual([]);
  });

  /** …and a pick it DID store survives, which is what "a saved summoner keeps its picks" means. */
  it('a stored signature pick is kept', () => {
    const ch = build('summoner', 9, { spells: { 1: ['500-toads'], 4: ['fly'] }, signatures: { 4: 'fly' } });
    const entry = ch.spellcasting.find((e) => e.id === 'summoner-casting');
    expect(entry!.signature).toEqual(['fly']);
  });

  /*
   * ── THE PICKER, which is the half that broke ──────────────────────────────────────────────────
   *
   * Every case above asserts the ENGINE, and every one of them passed while a summoner had no
   * signature spell at all and no way to designate one. They could: the engine reads
   * `build.signatures`, an old save holds nothing there, so "no signature" is the correct answer to
   * an empty store — and the star that fills the store had been left behind on the old exact-id
   * test in three separate files. The rule and the control disagreed and the suite could not see it.
   *
   * So the predicate itself is asserted here, and a source guard below pins that the controls read
   * it rather than re-deriving it.
   */
  it('the star is offered to a summoner from level 3 — the predicate all three controls read', () => {
    const summoner = content().classes.summoner;
    expect(signatureSpellsAt(summoner, 3), 'a level-3 summoner must be offered the signature star').toBe(true);
    expect(signatureSpellsAt(summoner, 20)).toBe(true);
    expect(signatureSpellsAt(summoner, 2), 'and not before the feature arrives').toBe(false);
    // The classes that reach it through the PLAIN id must keep doing so.
    expect(signatureSpellsAt(content().classes.bard, 3)).toBe(true);
    expect(signatureSpellsAt(content().classes.sorcerer, 3)).toBe(true);
    // A spontaneous caster that never gets the feature must not sprout one.
    expect(signatureSpellsAt(content().classes.fighter, 20)).toBe(false);
  });

  it('no control re-derives "does this class grant signature spells"', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) {
          for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
            // The one legal site is the body of `signatureSpellsAt` itself.
            if (/featureId\s*===\s*'signature-spells'/.test(line) && !/return !!cls\?\.features/.test(line)) offenders.push(`${p}: ${line.trim()}`);
          }
        }
      }
    };
    walk('src');
    expect(offenders, 'compare through signatureSpellsAt(cls, level) instead — a second copy is how the engine and the star came apart').toEqual([]);
  });

  /** The bard's Ultimate Polymath keeps the unlimited route — it is a printed rule, not the summoner's. */
  it('the bard\'s Ultimate Polymath still makes the whole repertoire signature', () => {
    const ch = build('bard', 20, { featPicks: { '20:class': 'ultimate-polymath' } });
    const entry = ch.spellcasting.find((e) => e.id === 'bard-casting');
    const repertoireSpells = [...new Set(Object.values(entry?.repertoire ?? {}).flat())];
    if (repertoireSpells.length) expect(new Set(entry!.signature)).toEqual(new Set(repertoireSpells));
  });
});
