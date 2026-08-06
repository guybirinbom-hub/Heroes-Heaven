import { describe, it, expect } from 'vitest';
import { build, content } from './_content';

/**
 * Staff Nexus: "You begin play with a makeshift staff of your own invention… it contains one cantrip
 * and one 1st-rank spell, both from your spellbook."
 *
 * Two of the three things this needed already existed — `grantsItems` really does put an item in the
 * inventory, it was just never read off CLASS FEATURES, and Staff Nexus is one. What was genuinely
 * missing was the staff itself and a place for the player's two spells to live: they come from that
 * wizard's own spellbook, so they belong to the INSTANCE and not to the shared item record.
 */
const db = content();
const STAFF = 'makeshift-staff';
const thesis = 'staff-nexus';

const wizard = (effectChoices?: Record<string, string>) =>
  build('wizard', 5, { extraChoices: { thesis: [thesis] }, ...(effectChoices ? { effectChoices } : {}) } as never);
const staffOf = (c: ReturnType<typeof wizard>) => c.inventory.find((i) => i.itemId === STAFF);

const cantrip = Object.values(db.spells).find((s) => s.rank === 0 && (s.traditions ?? []).includes('arcane'))!;
const first = Object.values(db.spells).find((s) => s.rank === 1 && !s.ritual && (s.traditions ?? []).includes('arcane'))!;

describe('Staff Nexus — a staff you actually start with', () => {
  it('the makeshift staff exists and is a staff', () => {
    expect(db.items[STAFF], 'the item was never created').toBeTruthy();
    expect(db.items[STAFF].traits).toContain('staff');
    expect(db.items[STAFF].traits).toContain('magical');
    // Its charge pool starts EMPTY: the maximum is whatever you expended this morning, not a fixed
    // property of the item.
    expect(db.items[STAFF].counters?.[0]?.startsFull).toBe(false);
  });

  it('a Staff Nexus wizard begins play holding it', () => {
    const s = staffOf(wizard());
    expect(s, 'the staff never reached the inventory').toBeTruthy();
    expect(s!.grantedBy).toMatch(/staff nexus/i);
  });

  it('…and a wizard of another thesis does not', () => {
    const other = db.classes.wizard?.extraChoices?.[0]?.options?.find((o: { id: string }) => o.id !== thesis)?.id;
    expect(other, 'no second thesis to compare with').toBeTruthy();
    expect(staffOf(build('wizard', 5, { extraChoices: { thesis: [other!] } } as never))).toBeUndefined();
  });

  it('the two chosen spells load into THAT staff, keyed by their own rank', () => {
    const c = wizard({
      [`${thesis}:staff-cantrip`]: cantrip.id,
      [`${thesis}:staff-spell`]: first.id,
    });
    const held = staffOf(c)?.heldSpellsOverride;
    expect(held, 'the picks never reached the staff').toBeTruthy();
    expect(held![0]).toEqual([cantrip.id]);
    expect(held![1]).toEqual([first.id]);
    // The shared item record must stay empty — every wizard would otherwise carry the same spells.
    expect(db.items[STAFF].heldSpells).toBeUndefined();
  });

  it('the staff reaches the Spells page as its own casting entry', () => {
    const c = wizard({
      [`${thesis}:staff-cantrip`]: cantrip.id,
      [`${thesis}:staff-spell`]: first.id,
    });
    const entry = c.spellcasting.find((e) => e.type === 'items' && e.itemInstanceId === staffOf(c)?.instanceId);
    expect(entry, 'the staff casts nothing').toBeTruthy();
    expect(entry!.repertoire?.[1]).toContain(first.id);
    expect(entry!.cantrips).toContain(cantrip.id);
  });

  it('answering neither pick leaves the staff empty rather than guessing', () => {
    expect(staffOf(wizard())?.heldSpellsOverride).toBeUndefined();
  });
});
