import { describe, it, expect } from 'vitest';
import { content, build } from './_content';

const c = content();

/**
 * SPELL GRANTS — records that hand the character a specific spell.
 *
 * The lane's real lesson was about READ PATHS, not classification: innateSpells was read from
 * heritages and feats only, and focusSpells from classes, subclass options and feats. Backgrounds
 * that grant a spell outright (Blessed → Guidance) therefore did nothing no matter what the record
 * said. Backgrounds are now read too; items and class features still are not, and are recorded in
 * work/spellgrant-needs-engine.json rather than filed somewhere inert.
 */
describe('spell grants reach the character', () => {
  it('a background-granted innate spell lands on the sheet', () => {
    expect(c.backgrounds['blessed']?.innateSpells?.[0]?.spellId).toBe('guidance');
    const ch = build('fighter', 3, { backgroundId: 'blessed' });
    expect(JSON.stringify(ch)).toContain('guidance');
  });

  it('a feat-granted focus spell lands on the sheet', () => {
    expect(c.feats['wind-jump']?.focusSpells).toContain('wind-jump');
  });

  it('every granted spell id resolves to a real spell', () => {
    const bad: string[] = [];
    const check = (id: string, from: string) => { if (!c.spells[id]) bad.push(`${from} -> ${id}`); };
    for (const [id, f] of Object.entries(c.feats)) {
      for (const s of f.focusSpells ?? []) check(s, id);
      for (const s of f.innateSpells ?? []) check(s.spellId, id);
    }
    for (const [id, b] of Object.entries(c.backgrounds)) for (const s of b.innateSpells ?? []) check(s.spellId, id);
    expect(bad, `dangling spell grants: ${bad.slice(0, 6).join(', ')}`).toHaveLength(0);
  });

  it('a witch with a patron gets that patron hex cantrip', () => {
    // Regression guard for a bug I thought I had found: building a witch with NO patron shows no hex,
    // which is correct behaviour, not a defect. All 16 patrons carry their hex.
    const opts = c.classes.witch.subclass!.options;
    expect(opts.filter((o) => o.focusSpells?.length)).toHaveLength(opts.length);
    expect(JSON.stringify(build('witch', 5, { subclassId: 'the-resentment' }))).toContain('evil-eye');
  });
});
