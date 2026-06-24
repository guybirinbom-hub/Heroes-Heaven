import { describe, it, expect } from 'vitest';
import { build, content } from './_content';

const db = content();

describe('Add-spell override', () => {
  it('surfaces non-ritual added spells as an "Added spells" entry and routes rituals out of it', () => {
    const ritual = Object.values(db.spells).find((s) => s.ritual)!;
    const c = build('wizard', 5, {
      overrides: { addedSpells: [{ spellId: 'fireball', rank: 3 }, { spellId: ritual.id, rank: ritual.rank }] },
    });
    const added = c.spellcasting.find((e) => e.id === 'added-spells');
    expect(added).toBeTruthy();
    // a non-ritual added at rank 3 lands under rank 3 in the entry's repertoire
    expect(added!.repertoire?.[3]).toContain('fireball');
    // the ritual is NOT in the Added-spells entry (it belongs to the Rituals section)
    const inEntry = [...(added!.cantrips ?? []), ...Object.values(added!.repertoire ?? {}).flat()];
    expect(inEntry).not.toContain(ritual.id);
  });

  it('places a rank-0 added spell in cantrips (at-will)', () => {
    const cantrip = Object.values(db.spells).find((s) => s.rank === 0 && !s.ritual)!;
    const c = build('wizard', 3, { overrides: { addedSpells: [{ spellId: cantrip.id, rank: 0 }] } });
    const added = c.spellcasting.find((e) => e.id === 'added-spells');
    expect(added?.cantrips).toContain(cantrip.id);
  });

  it('no Added-spells entry when the override is empty', () => {
    const c = build('wizard', 3, {});
    expect(c.spellcasting.find((e) => e.id === 'added-spells')).toBeUndefined();
  });
});
