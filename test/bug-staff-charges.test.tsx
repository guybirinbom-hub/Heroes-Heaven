// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { content, build } from './_content';
import { renderDom } from './_render';
import { CharacterSheet } from '../src/sheet/CharacterSheet';
import { applyPlayState, initialPlay, rest } from '../src/rules/play';
import { abilityMod } from '../src/rules/derive';
import { canCastFromItem, canPrepareStaff, highestSlotRank, itemCounters, openSlots } from '../src/rules/itemUses';
import type { Character, ContentDatabase, InventoryItem, PlayState } from '../src/rules/types';

/**
 * AUDIT (2026-09-13): "our daily prep button follows the pf2e rules correctly".
 *
 * Two findings live here.
 *
 * A. STAVES. GM Core "Preparing a Staff": *"During your daily preparations, you can prepare a staff
 *    you're holding. It gains a number of charges equal to the rank of your highest-rank spell slot
 *    (you can't prepare a staff if you have no spell slots). You can expend one spell slot to add a
 *    number of charges to the staff equal to that slot's rank."*
 *    The app sized the pool from the STAFF'S OWN LEVEL (`counterDefs`, `max:'level'`) and the dialog
 *    never mentioned staves at all — so a 6th-level wizard's Ringmaster's Staff held 6 charges
 *    instead of 3, and a Staff of the Magi held 20 instead of the caster's 10.
 *
 *    Two more printed limits ride on the same step and were equally absent: *"No one can prepare
 *    more than one staff per day"* and *"You can prepare a staff only if you have at least one of the
 *    staff's spells on your spell list"*.
 *
 * B. ADVANCED ALCHEMY happens "during your daily preparations", and the dialog never offered it.
 *
 * Every leg is mutation-proved: each assertion names the wrong implementation it would catch, and at
 * least one assertion per leg fails under the shipped behaviour or under the obvious wrong fix
 * (reading the item's level, or trusting the counter's saved max).
 */
const c = () => content();

const staffInv = (instanceId: string, itemId: string, extra: Partial<InventoryItem> = {}): InventoryItem => ({
  instanceId,
  itemId,
  quantity: 1,
  worn: false,
  equipped: true,
  ...extra,
});

/** Wire the sheet the way App.tsx does: onPlay updates the ledger, onRest applies rest(). */
function harness(base: Character, con: ContentDatabase, start: PlayState, seen: { play: PlayState }) {
  function Harness() {
    const [play, setPlay] = useState(start);
    seen.play = play;
    return (
      <CharacterSheet
        character={applyPlayState(base, play, con)}
        content={con}
        charKey="t"
        onPlay={(fn) => setPlay((p) => fn(p))}
        onRest={() =>
          setPlay((p) =>
            rest(p, {
              level: base.level,
              conMod: abilityMod(base.abilities.con),
              initialResources: base.classResources,
              modeDefs: con.modes,
              restRecovery: base.restRecovery,
            }),
          )
        }
      />
    );
  }
  return <Harness />;
}

const byText = (host: ParentNode, label: string) =>
  [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label) ?? null;
/** The open Daily preparations dialog. Scoping matters: the Main tab's AlchemyPanel behind it has a
 *  "Prepare item" button of its own that writes straight to play state. */
const dialog = (host: HTMLElement) => host.querySelector('.confirm-modal')!;
const bed = (host: HTMLElement) =>
  [...host.querySelectorAll('button')].find((b) => b.getAttribute('title') === 'Daily preparations') ?? null;
const staffRow = (play: PlayState, instanceId: string) =>
  (play.inventory ?? []).find((i) => i.instanceId === instanceId);

describe('A. a staff holds its WIELDER’s charges, never its own level', () => {
  it('a level-6 wizard’s Ringmaster’s Staff is a 3-charge staff, not a 6-charge one', () => {
    // bug 2026-09-13: staff charges
    const con = c();
    const base = build('wizard', 6) as Character;
    const live = applyPlayState(base, initialPlay(base, con), con);
    const def = con.items['ringmasters-staff'];
    const pool = itemCounters(def, staffInv('st1', 'ringmasters-staff'), highestSlotRank(live)).find((u) => u.id === 'pool')!;

    expect(highestSlotRank(live)).toBe(3);
    expect(pool.max).toBe(3);
    // MUTATION PROOF: the shipped code resolved `max:'level'` to item.level. Reinstate that and the
    // next line reads 6 === 6 and fails.
    expect(pool.max).not.toBe(def.level);
  });

  it('a level-20 wizard’s Staff of the Magi is capped by the caster (10), not by its level 20', () => {
    // bug 2026-09-13: staff charges
    const con = c();
    const base = build('wizard', 20) as Character;
    const live = applyPlayState(base, initialPlay(base, con), con);
    const def = con.items['staff-of-the-magi'];
    const pool = itemCounters(def, staffInv('st1', 'staff-of-the-magi'), highestSlotRank(live)).find((u) => u.id === 'pool')!;

    expect(highestSlotRank(live)).toBe(10);
    expect(pool.max).toBe(10);
    // MUTATION PROOF: item.level here is 20 — double the real answer, and the single loudest case in
    // the report. A fix that clamps to 10 by coincidence (Math.min(10, level)) would pass this and
    // fail the 6th-level wizard above, so the pair has to be read together.
    expect(pool.max).not.toBe(def.level);
  });

  it('a character with NO spell slots gets no charges — and no free casts either', () => {
    // bug 2026-09-13: staff charges
    const con = c();
    const base = build('fighter', 6) as Character;
    const live = applyPlayState(base, initialPlay(base, con), con);
    const def = con.items['ringmasters-staff'];
    const inv = staffInv('st1', 'ringmasters-staff');
    const pool = itemCounters(def, inv, highestSlotRank(live)).find((u) => u.id === 'pool')!;

    expect(highestSlotRank(live)).toBe(0);
    expect(pool.max).toBe(0);
    // MUTATION PROOF: the tempting shape is to DROP a 0-max counter (the old `.filter(c => c.max > 0)`
    // did exactly that). Then `canCastFromItem` finds no tracker, reads the staff as at-will and hands
    // a non-caster unlimited casts — so the counter has to survive at 0…
    expect(pool).toBeTruthy();
    expect(canCastFromItem(def, inv, 1, highestSlotRank(live))).toBe(false);
    // …while a cantrip from a staff costs nothing and stays legal ("Casting Cantrips from a Staff").
    expect(canCastFromItem(def, inv, 0, highestSlotRank(live))).toBe(true);
  });

  it('a max saved BEFORE the fix does not resurrect the bug', () => {
    // bug 2026-09-13: staff charges
    const con = c();
    const base = build('wizard', 6) as Character;
    const live = applyPlayState(base, initialPlay(base, con), con);
    // Every charge-pip click wrote the counter's max back to play state, so real saves hold 6 here.
    const stale = staffInv('st1', 'ringmasters-staff', { counters: { pool: { current: 6, max: 6, resetsOnRest: true } } });
    const pool = itemCounters(con.items['ringmasters-staff'], stale, highestSlotRank(live)).find((u) => u.id === 'pool')!;

    expect(pool.max).toBe(3);
    // MUTATION PROOF: "just read inv.counters[id].max" is the obvious one-line fix and it is wrong —
    // it reads back the stale 6 and the bug is still shipped.
    expect(pool.max).not.toBe(6);
    expect(pool.current).toBe(3); // and the stale current is clamped down, not shown as 6/3
  });

  it('the charges a morning’s prep put in the staff survive a reload', () => {
    // bug 2026-09-13: staff charges
    const con = c();
    const base = build('wizard', 6) as Character;
    const live = applyPlayState(base, initialPlay(base, con), con);
    // 3 base + a 2nd-rank slot expended into it at daily preparations.
    const prepared = staffInv('st1', 'ringmasters-staff', { staffCharges: 5 });
    const pool = itemCounters(con.items['ringmasters-staff'], prepared, highestSlotRank(live)).find((u) => u.id === 'pool')!;

    // MUTATION PROOF: drop `staffCharges` and the expended slot silently evaporates on the next
    // render — the player pays a 2nd-rank slot for nothing.
    expect(pool.max).toBe(5);
    expect(pool.current).toBe(5);
  });

  it('a multiclass caster’s highest rank is the highest across ALL of their slot entries', () => {
    // bug 2026-09-13: staff charges
    // MUTATION PROOF: return on the first entry that has slots and a sorcerer/wizard's staff is sized
    // by whichever entry happens to be listed first.
    const twoEntries = {
      spellcasting: [
        { id: 'a', name: 'A', type: 'spontaneous', tradition: 'arcane', slots: { 1: { used: 0, max: 2 } } },
        { id: 'b', name: 'B', type: 'prepared', tradition: 'occult', prepared: { 5: [{}] } },
      ],
    } as unknown as Character;
    expect(highestSlotRank(twoEntries)).toBe(5);
    expect(openSlots(twoEntries).map((o) => o.rank)).toEqual([1, 5]);
  });

  it('a Staff Nexus makeshift staff is read off the INSTANCE, not off the printed staff', () => {
    // bug 2026-09-13: staff charges
    // "You can create a makeshift staff… choosing spells from your spellbook." The wizard's own picks
    // live on the row, so the spell-list gate has to read those first.
    const con = c();
    const base = build('cleric', 6) as Character;
    const cleric = applyPlayState(base, initialPlay(base, con), con);
    const def = con.items['staff-of-earth'];
    expect(canPrepareStaff(def, staffInv('st1', 'staff-of-earth'), cleric, con.spells)).toBe(false);
    const divine = Object.values(con.spells).find((s) => (s.traditions ?? []).includes('divine') && !(s.traditions ?? []).includes('arcane'))!;
    const made = staffInv('st1', 'staff-of-earth', { heldSpellsOverride: { 1: [divine.id] } } as Partial<InventoryItem>);
    // MUTATION PROOF: read item.heldSpells first and the instance's own list is never consulted.
    expect(canPrepareStaff(def, made, cleric, con.spells)).toBe(true);
  });

  it('openSlots offers a rank to burn for both kinds of caster, and none for a non-caster', () => {
    // bug 2026-09-13: staff charges
    const con = c();
    const prep = applyPlayState(build('wizard', 6) as Character, initialPlay(build('wizard', 6) as Character, con), con);
    const spont = applyPlayState(build('sorcerer', 6) as Character, initialPlay(build('sorcerer', 6) as Character, con), con);
    const none = applyPlayState(build('fighter', 6) as Character, initialPlay(build('fighter', 6) as Character, con), con);

    expect(openSlots(prep).map((o) => o.rank)).toEqual([1, 2, 3]);
    // A prepared caster's option addresses ONE slot (index) — a spontaneous caster's addresses the
    // rank's pool. MUTATION PROOF: collapse the two and one of the two callers expends nothing.
    expect(openSlots(prep)[0].index).toBe(0);
    expect(openSlots(prep)[0].pool).toBeUndefined();
    expect(openSlots(spont).map((o) => o.rank)).toEqual([1, 2, 3]);
    expect(openSlots(spont)[0].pool).toBeTruthy();
    expect(openSlots(none)).toEqual([]);
  });
});

describe('A. "only if you have at least one of the staff’s spells on your spell list"', () => {
  it('a divine cleric cannot prepare an arcane/primal staff; a wizard can', () => {
    // bug 2026-09-13: staff charges
    const con = c();
    const def = con.items['staff-of-earth'];
    const inv = staffInv('st1', 'staff-of-earth');
    const cleric = applyPlayState(build('cleric', 6) as Character, initialPlay(build('cleric', 6) as Character, con), con);
    const wizard = applyPlayState(build('wizard', 6) as Character, initialPlay(build('wizard', 6) as Character, con), con);

    // The fixture has to actually be the case the rule is about, or the leg proves nothing.
    expect(Object.values(def.heldSpells ?? {}).flat().length).toBeGreaterThan(0);
    expect(canPrepareStaff(def, inv, cleric, con.spells)).toBe(false);
    // MUTATION PROOF: drop the tradition test (or answer `true` on any spell at all) and this reads
    // true — the cleric prepares a staff holding nothing they can cast.
    expect(canPrepareStaff(def, inv, wizard, con.spells)).toBe(true);
  });

  it('a staff the database has no spell list for is not refused', () => {
    // bug 2026-09-13: staff charges
    const con = c();
    const wizard = applyPlayState(build('wizard', 6) as Character, initialPlay(build('wizard', 6) as Character, con), con);
    const bare = { ...con.items['staff-of-earth'], heldSpells: undefined };
    // MUTATION PROOF: `return false` on an unreadable list zeroes the 31 shipped staves that carry no
    // heldSpells at all. Silence in the data is not a "no".
    expect(canPrepareStaff(bare, staffInv('st1', 'staff-of-earth'), wizard, con.spells)).toBe(true);
    expect(canPrepareStaff(con.items['staff-of-earth'], staffInv('st1', 'staff-of-earth'), wizard, {})).toBe(true);
  });

  it('a cantrip-only caster has a spell list but no SLOT, so no staff', () => {
    // bug 2026-09-13: staff charges
    // "You can't prepare a staff if you have no spell slots." An archetype dedication before its
    // Basic Spellcasting feat is exactly that shape: a tradition with nothing in it to spend.
    const con = c();
    const cantripsOnly = {
      spellcasting: [{ id: 'a', name: 'A', type: 'spontaneous', tradition: 'arcane', slots: { 0: { used: 0, max: 5 } } }],
    } as unknown as Character;
    expect(highestSlotRank(cantripsOnly)).toBe(0);
    expect(openSlots(cantripsOnly)).toEqual([]);
    // MUTATION PROOF: gate on the TRADITION alone and this reads true — the cantrip caster's arcane
    // list matches the staff's arcane spells and they prepare a staff they have no slot to charge.
    expect(canPrepareStaff(con.items['staff-of-earth'], staffInv('st1', 'staff-of-earth'), cantripsOnly, con.spells)).toBe(false);
  });

  it('an innate-only caster has no spell list to match against', () => {
    // bug 2026-09-13: staff charges
    const con = c();
    const fighter = applyPlayState(build('fighter', 6) as Character, initialPlay(build('fighter', 6) as Character, con), con);
    expect(canPrepareStaff(con.items['staff-of-earth'], staffInv('st1', 'staff-of-earth'), fighter, con.spells)).toBe(false);
    // …and an innate entry the fighter DOES have is still not a spell list. MUTATION PROOF: drop the
    // prepared/spontaneous filter in castingTraditions and a single amulet spell starts preparing staves.
    const withAmulet = {
      ...fighter,
      spellcasting: [{ id: 'amulet', name: 'Amulet', type: 'innate', tradition: 'arcane', slots: { 1: { used: 0, max: 1 } } }],
    } as unknown as Character;
    expect(canPrepareStaff(con.items['staff-of-earth'], staffInv('st1', 'staff-of-earth'), withAmulet, con.spells)).toBe(false);
  });

  it('an innate spell on ANOTHER tradition does not widen a real caster’s spell list', () => {
    // bug 2026-09-13: staff charges
    // A divine cleric who also carries an arcane-casting item still cannot prepare the arcane staff:
    // "your spell list" is the list you cast SLOT spells from, and an item's one spell joins no list.
    const con = c();
    const base = build('cleric', 6) as Character;
    const cleric = applyPlayState(base, initialPlay(base, con), con);
    const withItemSpell = {
      ...cleric,
      spellcasting: [
        ...(cleric.spellcasting ?? []),
        { id: 'wand', name: 'Wand', type: 'innate', tradition: 'arcane', slots: { 1: { used: 0, max: 1 } } },
      ],
    } as unknown as Character;
    expect(highestSlotRank(withItemSpell)).toBe(3); // the cleric's own divine slots, unchanged
    // MUTATION PROOF: drop the prepared/spontaneous filter in castingTraditions and this reads true.
    expect(canPrepareStaff(con.items['staff-of-earth'], staffInv('st1', 'staff-of-earth'), withItemSpell, con.spells)).toBe(false);
  });
});

describe('A. the Daily preparations dialog prepares the staff', () => {
  const wizardWithStaff = (con: ContentDatabase) => {
    const base = build('wizard', 6) as Character;
    const seed = initialPlay(base, con);
    const start: PlayState = { ...seed, inventory: [...(seed.inventory ?? []), staffInv('st1', 'ringmasters-staff')] };
    return { base, start };
  };

  it('"Prepare for the day" fills the staff to the caster’s highest rank', () => {
    // bug 2026-09-13: staff charges
    const con = c();
    const { base, start } = wizardWithStaff(con);
    const seen = { play: start };
    const { host, click, stop } = renderDom(harness(base, con, start, seen));
    try {
      click(bed(host));
      // The step exists, names the staff, and says what preparing it gives.
      expect(host.textContent).toContain('Ringmaster');
      expect(host.textContent).toContain('Prepare: 3 charges');
      const confirm = byText(host, 'Prepare for the day') as HTMLButtonElement;
      expect(confirm.disabled).toBe(false);
      click(confirm);

      const row = staffRow(seen.play, 'st1')!;
      // MUTATION PROOF: skip `staffCharges` and the day's pool falls back to the live rank the moment
      // the wizard levels mid-day; skip the counter and the staff is prepared but empty.
      expect(row.staffCharges).toBe(3);
      expect(row.counters?.pool).toEqual({ current: 3, max: 3, resetsOnRest: true });
      // (The ORDER against onRest() is proved by the expended-slot and Advanced Alchemy legs — a
      // staff written before rest() survives it, an expended slot and an infused item do not.)
    } finally {
      stop();
    }
  });

  it('expending a 2nd-rank slot adds 2 charges and spends that slot', () => {
    // bug 2026-09-13: staff charges
    const con = c();
    const { base, start } = wizardWithStaff(con);
    const seen = { play: start };
    const { host, click, stop } = renderDom(harness(base, con, start, seen));
    try {
      click(bed(host));
      click([...host.querySelectorAll('button')].find((b) => b.getAttribute('data-ctl-title') === 'Expend a spell slot') ?? null);
      const opt = [...host.querySelectorAll('button.picker-item')].find((b) =>
        (b.querySelector('.picker-name')?.textContent ?? '').startsWith('2nd-rank slot'),
      );
      expect(opt, 'the picker no longer offers a 2nd-rank slot').toBeTruthy();
      click(opt!);
      // The headline updates before the player commits — 3 + 2.
      expect(host.textContent).toContain('Prepare: 5 charges');
      click(byText(host, 'Prepare for the day'));

      const row = staffRow(seen.play, 'st1')!;
      expect(row.staffCharges).toBe(5);
      expect(row.counters?.pool).toEqual({ current: 5, max: 5, resetsOnRest: true });
      // The slot is GONE for the day. MUTATION PROOF: expend it before onRest() and rest()'s
      // `expendedSlots: {}` hands it straight back — free charges every morning.
      expect(seen.play.expendedSlots['wizard-casting:2:0']).toBe(true);
      expect(Object.keys(seen.play.expendedSlots)).toEqual(['wizard-casting:2:0']);
    } finally {
      stop();
    }
  });

  it('Cancel leaves the staff empty-handed and the slot unspent', () => {
    // bug 2026-09-13: staff charges
    const con = c();
    const { base, start } = wizardWithStaff(con);
    const seen = { play: start };
    const { host, click, stop } = renderDom(harness(base, con, start, seen));
    try {
      click(bed(host));
      click([...host.querySelectorAll('button')].find((b) => b.getAttribute('data-ctl-title') === 'Expend a spell slot') ?? null);
      const opt = [...host.querySelectorAll('button.picker-item')].find((b) =>
        (b.querySelector('.picker-name')?.textContent ?? '').startsWith('2nd-rank slot'),
      );
      click(opt!);
      click(byText(host, 'Cancel'));

      // Same object reference ⇒ not one updatePlay fired: no charges, no expended slot, no rest.
      expect(seen.play).toBe(start);
      expect(staffRow(seen.play, 'st1')!.staffCharges).toBeUndefined();
      expect(seen.play.expendedSlots).toEqual({});

      // …and the cancelled pick must not come back pre-selected the next morning.
      click(bed(host));
      expect(host.textContent).toContain('Prepare: 3 charges');
    } finally {
      stop();
    }
  });

  it('two staves, one morning: only the chosen one is charged', () => {
    // bug 2026-09-13: staff charges
    const con = c();
    const base = build('wizard', 6) as Character;
    const seed = initialPlay(base, con);
    const start: PlayState = {
      ...seed,
      inventory: [...(seed.inventory ?? []), staffInv('st1', 'ringmasters-staff'), staffInv('st2', 'staff-of-earth')],
    };
    const seen = { play: start };
    const { host, click, stop } = renderDom(harness(base, con, start, seen));
    try {
      click(bed(host));
      // Both are listed; the first is the default pick and the other says it gets nothing today.
      expect(host.textContent).toContain('Prepare: 3 charges');
      expect(host.textContent).toContain('Not prepared today — 0 charges');
      const picks = [...host.querySelectorAll('.confirm-modal .daily-opt')];
      expect(picks.length).toBe(2);
      click(picks[1]); // …choose the SECOND staff instead
      click(byText(host, 'Prepare for the day'));

      // "No one can prepare more than one staff per day."
      expect(staffRow(seen.play, 'st2')!.staffCharges).toBe(3);
      expect(staffRow(seen.play, 'st2')!.counters?.pool).toEqual({ current: 3, max: 3, resetsOnRest: true });
      // MUTATION PROOF: prepare every carried staff (the first cut of this step did) and the next two
      // lines read 3 — two staves, six charges, on one morning.
      expect(staffRow(seen.play, 'st1')!.staffCharges).toBe(0);
      expect(staffRow(seen.play, 'st1')!.counters?.pool).toEqual({ current: 0, max: 0, resetsOnRest: true });
    } finally {
      stop();
    }
  });

  it('the expended slot’s charges go to the prepared staff and nowhere else', () => {
    // bug 2026-09-13: staff charges
    const con = c();
    const base = build('wizard', 6) as Character;
    const seed = initialPlay(base, con);
    const start: PlayState = {
      ...seed,
      inventory: [...(seed.inventory ?? []), staffInv('st1', 'ringmasters-staff'), staffInv('st2', 'staff-of-earth')],
    };
    const seen = { play: start };
    const { host, click, stop } = renderDom(harness(base, con, start, seen));
    try {
      click(bed(host));
      // The slot picker belongs to the CHOSEN staff only — one staff, one row offering it.
      expect([...host.querySelectorAll('[data-ctl-title="Expend a spell slot"]')].length).toBe(1);
      click([...host.querySelectorAll('button')].find((b) => b.getAttribute('data-ctl-title') === 'Expend a spell slot') ?? null);
      click(
        [...host.querySelectorAll('button.picker-item')].find((b) =>
          (b.querySelector('.picker-name')?.textContent ?? '').startsWith('2nd-rank slot'),
        )!,
      );
      click(byText(host, 'Prepare for the day'));

      expect(staffRow(seen.play, 'st1')!.staffCharges).toBe(5);
      // MUTATION PROOF: hang the bonus on the staves loop instead of on the chosen one and the
      // unprepared staff picks up +2 from a slot it had nothing to do with.
      expect(staffRow(seen.play, 'st2')!.staffCharges).toBe(0);
      expect(seen.play.expendedSlots['wizard-casting:2:0']).toBe(true);
    } finally {
      stop();
    }
  });

  it('a staff off your spell list says so, and is left empty', () => {
    // bug 2026-09-13: staff charges
    const con = c();
    const base = build('cleric', 6) as Character;
    const seed = initialPlay(base, con);
    const start: PlayState = { ...seed, inventory: [...(seed.inventory ?? []), staffInv('st1', 'staff-of-earth')] };
    const seen = { play: start };
    const { host, click, stop } = renderDom(harness(base, con, start, seen));
    try {
      click(bed(host));
      expect(highestSlotRank(applyPlayState(base, start, con))).toBe(3); // the cleric DOES have slots
      // …so the only reason it can't be prepared is the spell list, and the step has to say which.
      expect(host.textContent).toContain('Can’t prepare — none of its spells are on your spell list');
      expect(host.textContent).not.toContain('Prepare: 3 charges');
      // No staff is preparable, so there is nothing to expend a slot into either.
      expect([...host.querySelectorAll('[data-ctl-title="Expend a spell slot"]')].length).toBe(0);
      click(byText(host, 'Prepare for the day'));

      // MUTATION PROOF: skip the spell-list gate and this reads 3 — a divine cleric wielding an
      // arcane/primal staff they cannot legally prepare.
      expect(staffRow(seen.play, 'st1')!.staffCharges).toBe(0);
      expect(staffRow(seen.play, 'st1')!.counters?.pool.max).toBe(0);
      expect(seen.play.expendedSlots).toEqual({});
    } finally {
      stop();
    }
  });

  it('a character with no spell slots is never shown the step', () => {
    // bug 2026-09-13: staff charges
    const con = c();
    const base = build('fighter', 6) as Character;
    const seed = initialPlay(base, con);
    const start: PlayState = { ...seed, inventory: [...(seed.inventory ?? []), staffInv('st1', 'ringmasters-staff')] };
    const seen = { play: start };
    const { host, click, stop } = renderDom(harness(base, con, start, seen));
    try {
      click(bed(host));
      // "You can't prepare a staff if you have no spell slots."
      expect(host.textContent).not.toContain('Staves you prepare today');
      click(byText(host, 'Prepare for the day'));
      expect(staffRow(seen.play, 'st1')!.staffCharges).toBeUndefined();
    } finally {
      stop();
    }
  });
});

describe('B. Advanced Alchemy is a daily preparation', () => {
  const alchemist = (con: ContentDatabase) => {
    const base = build('alchemist', 5) as Character;
    return { base, start: initialPlay(base, con) };
  };

  it('a level-5 alchemist gets the step, with the day’s allowance on it', () => {
    // bug 2026-09-13: staff charges
    const con = c();
    const { base, start } = alchemist(con);
    const seen = { play: start };
    const { host, click, stop } = renderDom(harness(base, con, start, seen));
    try {
      click(bed(host));
      expect(base.advancedAlchemy?.max).toBe(5);
      // MUTATION PROOF: the budget must come from the built character (Efficient Alchemy raises it),
      // never from a hardcoded 4 + Int — print a literal and this reads "0/5" or "0/4".
      expect(host.textContent).toContain('Advanced Alchemy — today’s infused items (0/5)');
    } finally {
      stop();
    }
  });

  it('a fighter is not offered it', () => {
    // bug 2026-09-13: staff charges
    const con = c();
    const base = build('fighter', 5) as Character;
    const start = initialPlay(base, con);
    const seen = { play: start };
    const { host, click, stop } = renderDom(harness(base, con, start, seen));
    try {
      click(bed(host));
      expect(host.textContent).not.toContain('Advanced Alchemy');
    } finally {
      stop();
    }
  });

  it('the picks are applied on confirm', () => {
    // bug 2026-09-13: staff charges
    const con = c();
    const { base, start } = alchemist(con);
    const seen = { play: start };
    const { host, click, stop } = renderDom(harness(base, con, start, seen));
    try {
      click(bed(host));
      click(byText(dialog(host), 'Prepare item'));
      const row = host.querySelector('.alchemy-pick-list .pick-row');
      expect(row, 'the shared alchemy picker rendered no items').toBeTruthy();
      const name = row!.querySelector('.picker-name')!.textContent!;
      click(row!.querySelector('.pick-add'));
      // Picked into the DRAFT only — nothing committed while the dialog is open.
      expect(seen.play).toBe(start);
      click(byText(host, 'Prepare for the day'));

      const picked = Object.entries(seen.play.alchemyPrep ?? {});
      expect(picked.length).toBe(1);
      expect(con.items[picked[0][0]].name).toBe(name);
      expect(picked[0][1]).toBe(1);
    } finally {
      stop();
    }
  });

  it('Cancel applies none of them', () => {
    // bug 2026-09-13: staff charges
    const con = c();
    const { base, start } = alchemist(con);
    const seen = { play: start };
    const { host, click, stop } = renderDom(harness(base, con, start, seen));
    try {
      click(bed(host));
      click(byText(dialog(host), 'Prepare item'));
      click(host.querySelector('.alchemy-pick-list .pick-row .pick-add'));
      click(byText(host, 'Cancel'));
      expect(seen.play).toBe(start);
      expect(seen.play.alchemyPrep).toBeUndefined();

      // …and the cancelled morning's batch is not waiting in the draft on the next open.
      click(bed(host));
      expect(host.textContent).toContain('today’s infused items (0/5)');
    } finally {
      stop();
    }
  });
});
