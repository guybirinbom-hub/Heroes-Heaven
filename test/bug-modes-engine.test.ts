// @vitest-environment jsdom
/*
 * The ENGINE half of the 573-record modes-vs-print audit's last four findings.
 *
 * Each one is a printed sentence that the data could already say (or now can) and that no code read,
 * so the record shipped complete and inert. Every `it` below is a LEG: it moves a number a player can
 * see, and each was mutation-proved against the fix it covers — the failure line is quoted beside it,
 * so a later refactor that quietly removes the rule cannot leave a green test behind.
 *
 * jsdom for the whole file because finding #113's second half is a CONTROL, not a number: a mark the
 * player cannot reach is a rider that matches nothing.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { content, build } from './_content';
import { renderDom, renderText } from './_render';
import { InventoryTab, STEADYING_HAND_ITEM } from '../src/sheet/InventoryTab';
import { DefensesPills } from '../src/sheet/DefensesPills';
import { VitalsRail } from '../src/sheet/VitalsRail';
import { normalizeCharacter } from '../src/rules/normalize';
import { modeNumberBonus, modeTargetLabel } from '../src/rules/modes';
import { deriveAc, deriveArmorCheckPenalty, deriveDefenses, deriveSkill, deriveSpeeds, deriveStrike } from '../src/rules/derive';
import { applyPlayState, emptyPlay } from '../src/rules/play';
import type { Character, ContentDatabase, InventoryItem, ModeDef, ProficiencyKey } from '../src/rules/types';

const c = content();
const noop = (() => undefined) as never;

/** Replace the character's inventory outright — the armour/weapon idiom the armor tests already use. */
const carrying = (ch: Character, inventory: InventoryItem[]): Character => ({ ...ch, inventory });
const withStr = (ch: Character, score: number): Character => ({ ...ch, abilities: { ...ch.abilities, str: score } });

/* ---------------------------------------------------------------------------------------------- *
 * 1 — LORE TARGETS.  `lore:*`, the wildcard a per-character skill set forces.
 * ---------------------------------------------------------------------------------------------- */

describe('finding: a mode modifier targeting every Lore', () => {
  // bug 2026-09-15: modes engine
  it('moves each of the character’s Lores and leaves the other skills alone', () => {
    /*
     * The four silvertongue mutagens print a −2 item penalty on the "worse at everything bookish" half
     * of the mutagen trade, and the Lores are named as a CATEGORY — the drinker's own set, which a
     * shared record cannot enumerate. The seed says so with `detail: 'lore:*'`; `modeMatches` compared
     * details with `===`, so the entry matched a Lore literally called "*" and therefore nothing.
     *
     * MUTATION PROOF — drop the wildcard clause in modes.ts (`if (mod.detail === 'lore:*') …`):
     *   AssertionError: Legal Lore takes the printed −2: expected 5 to be 3 // Object.is equality
     */
    const mode = c.modes['item-silvertongue-mutagen-lesser'];
    expect(mode, 'the seed record this leg reads').toBeTruthy();
    const lore = mode.modifiers.find((m) => m.detail === 'lore:*');
    expect(lore, 'the printed Lore penalty, as the seed spells it').toBeTruthy();
    expect(lore!.value).toBe(-2);
    expect(lore!.type).toBe('item');

    const base = build('rogue', 3);
    const ch: Character = {
      ...base,
      proficiencies: {
        ...base.proficiencies,
        skills: { ...base.proficiencies.skills, 'lore:legal': 'trained', 'lore:sailing': 'trained' },
      },
    };
    const on: Character = { ...ch, activeModes: [mode] };

    const legal = 'lore:legal' as ProficiencyKey;
    expect(deriveSkill(on, legal, c).modifier, 'Legal Lore takes the printed −2').toBe(deriveSkill(ch, legal, c).modifier - 2);
    // Every Lore, not the first one found: the sentence says "Lore checks", plural and unqualified.
    const sailing = 'lore:sailing' as ProficiencyKey;
    expect(deriveSkill(on, sailing, c).modifier).toBe(deriveSkill(ch, sailing, c).modifier - 2);
    // …and the mutagen's own +1 to Diplomacy is untouched by it, which is what "nothing else" means.
    expect(deriveSkill(on, 'diplomacy', c).modifier).toBe(deriveSkill(ch, 'diplomacy', c).modifier + 1);
  });

  // bug 2026-09-15: modes engine
  it('a plain `lore:legal` still matches that one Lore and no other', () => {
    /*
     * The wildcard must not widen the ordinary spelling: a mode written in the editor against one Lore
     * names one Lore. MUTATION PROOF — make the clause `mod.detail?.startsWith('lore:')` instead of an
     * equality on `'lore:*'`:
     *   AssertionError: a single Lore modifier stays on its own Lore: expected -1 to be +0 // Object.is equality
     */
    const one: ModeDef[] = [{ id: 'm', name: 'One Lore', modifiers: [{ value: -1, type: 'item', target: 'skill', detail: 'lore:legal' }] }];
    expect(modeNumberBonus(one, { kind: 'skill', detail: 'lore:legal' })).toBe(-1);
    expect(modeNumberBonus(one, { kind: 'skill', detail: 'lore:sailing' }), 'a single Lore modifier stays on its own Lore').toBe(0);
    expect(modeNumberBonus(one, { kind: 'skill', detail: 'stealth' })).toBe(0);

    const star: ModeDef[] = [{ id: 'm', name: 'All Lores', modifiers: [{ value: -2, type: 'item', target: 'skill', detail: 'lore:*' }] }];
    expect(modeNumberBonus(star, { kind: 'skill', detail: 'lore:anything-at-all' })).toBe(-2);
    // The star is a Lore wildcard, never a skill wildcard: Stealth is not a Lore.
    expect(modeNumberBonus(star, { kind: 'skill', detail: 'stealth' })).toBe(0);
    // And it reads as the category in the breakdown, not as a Lore named "*".
    expect(modeTargetLabel(star[0].modifiers[0])).toBe('Lore');
  });
});

/* ---------------------------------------------------------------------------------------------- *
 * 2 — FORMS THAT IGNORE ARMOUR (finding #95).
 * ---------------------------------------------------------------------------------------------- */

describe('finding #95: a battle form ignores the armour it replaced', () => {
  /*
   * PRINTED, from public/core-descriptions.json:
   *   pest form      — "AC = 15 + your level. Ignore your armor's check penalty and Speed reduction."
   *   elemental form — "AC = 19 + your level. Ignore your armor's check penalty and Speed reduction."
   *   cosmic form    — "AC = 21 + your level. Ignore your armor check's penalty and Speed reduction."
   *
   * Two sentences, one statement — which is why the rule is keyed on `battleForm.ac`, a field the
   * records ALREADY carry, rather than on a new data field or a list of mode ids. Pest form reaches the
   * app as Critter Shape (the druid feat whose note quotes pest form outright); elemental form as Storm
   * Form; cosmic form as Transcend the Azimuth. All three state an AC; none of them stopped charging
   * their wearer for the armour the form had already made irrelevant.
   */
  const PEST = 'critter-shape'; // pest form's record in this database — see the note it quotes
  const ARMOR = 'scale-mail'; // check penalty −2, Speed penalty −5 ft, Strength threshold +2
  /** Str 10 (mod 0 < +2), so the armour's penalties are live before the form goes on. */
  const inScale = () => carrying(withStr(build('druid', 5), 10), [{ instanceId: 'a1', itemId: ARMOR, quantity: 1, worn: true }]);
  const shifted = (ch: Character): Character => ({ ...ch, activeModes: [c.modes[PEST]] });

  it('the three records really do state an AC — the field the rule keys on', () => {
    for (const id of [PEST, 'storm-form', 'transcend-the-azimuth-moon']) {
      expect(c.modes[id]?.battleForm?.ac, `${id} states its own AC`).toBeTruthy();
    }
    // The line the rule draws: a werecreature's Change Shape states Speeds and NO AC — it is not a form
    // that replaces your defences, so RAW its wearer keeps paying the armour. It must stay that way.
    expect(c.modes['were-werewolf-animal']?.battleForm?.speeds).toBeTruthy();
    expect(c.modes['were-werewolf-animal']?.battleForm?.ac).toBeUndefined();
  });

  // bug 2026-09-15: modes engine
  it('no check penalty on Stealth or Athletics while the form runs, and it returns when it ends', () => {
    /*
     * MUTATION PROOF — remove the `ignoresArmorPenalties(c)` guard from deriveArmorCheckPenalty:
     *   AssertionError: the form ignores the armor's check penalty: expected -2 to be +0 // Object.is equality
     */
    const off = inScale();
    const on = shifted(off);
    expect(deriveArmorCheckPenalty(off, c).value, 'the penalty is live before the form').toBe(-2);
    expect(deriveArmorCheckPenalty(on, c).value, "the form ignores the armor's check penalty").toBe(0);
    for (const skill of ['stealth', 'athletics', 'acrobatics', 'thievery'] as const) {
      expect(deriveSkill(off, skill, c).modifier, `${skill} pays it with the form off`).toBe(deriveSkill(off, skill).modifier - 2);
      expect(deriveSkill(on, skill, c).modifier, `${skill} does not pay it in the form`).toBe(deriveSkill(on, skill).modifier);
    }
    // Switching the form off restores it — the rule is derived from the live toggle, never latched.
    expect(deriveArmorCheckPenalty({ ...on, activeModes: [] }, c).value).toBe(-2);
  });

  // bug 2026-09-15: modes engine
  it('no −5 ft either: the form’s own Speed is the printed one, not the printed one minus the armour', () => {
    /*
     * The second half of the same sentence. Pest form prints "Speed 20 feet"; a druid in scale mail
     * walked at 15 while wearing armour the form had absorbed.
     *
     * MUTATION PROOF — drop `|| ignoresArmorPenalties(c)` from deriveSpeeds' `ignoreArmor`:
     *   AssertionError: the form's printed Speed, whole: expected 15 to be 20 // Object.is equality
     */
    const off = inScale();
    const on = shifted(off);
    expect(c.modes[PEST].battleForm!.speeds!.land, 'the form prints 20 feet').toBe(20);
    expect(deriveSpeeds(on, c).land, "the form's printed Speed, whole").toBe(20);
    // …and the armour's −5 is demonstrably still a real penalty for the same character out of the form.
    const barefoot = carrying(off, []);
    expect(deriveSpeeds(off, c).land, 'the penalty is live before the form').toBe(deriveSpeeds(barefoot, c).land - 5);
    expect(deriveSpeeds({ ...on, activeModes: [] }, c).land, 'and it comes straight back').toBe(deriveSpeeds(off, c).land);
  });

  // bug 2026-09-15: modes engine
  it('a form that states no AC does NOT ignore the armour — the werecreature line holds', () => {
    /*
     * The guard on the guard. Keying the rule on "any battle form" would have handed every werecreature
     * a free pass out of their plate, which no printed Change Shape says.
     *
     * MUTATION PROOF — key `ignoresArmorPenalties` on `activeBattleForm(c) != null` instead of on `.ac`:
     *   AssertionError: a Speed-only shape still pays for the armour: expected +0 to be -2 // Object.is equality
     */
    const ch = { ...inScale(), activeModes: [c.modes['were-werewolf-animal']] };
    expect(deriveArmorCheckPenalty(ch, c).value, 'a Speed-only shape still pays for the armour').toBe(-2);
  });
});

/* ---------------------------------------------------------------------------------------------- *
 * 3 — A MODE THAT APPLIES A CONDITION (finding #112).
 * ---------------------------------------------------------------------------------------------- */

describe('finding #112: a mode that applies a condition', () => {
  /*
   * PRINTED, from public/core-descriptions.json (curse-of-the-skys-call, and the record's own note):
   *   "Cursebound 1: you are enfeebled 1, and the same −1 status penalty applies to your DCs against
   *    forced movement."
   *
   * The forced-movement half shipped as three conditional save modifiers. The enfeebled half had no
   * field at all, so it shipped as prose — and the hydra mutagen and the giant catch pole each carry a
   * note that reads "Clumsy 1 (apply as a condition)", which is the app asking the player to do its
   * arithmetic by hand. `ModeDef.conditions` is that field; `applyPlayState` derives them.
   *
   * The leg uses a hand-built ModeDef: the seed records cannot be edited from this lane, and the list
   * of which record should carry which value is reported to the data lane instead.
   */
  const enfeebling = (value: number): ModeDef => ({
    id: 'test-skys-call-1',
    name: "Sky's Call 1",
    modifiers: [],
    conditions: [{ id: 'enfeebled', value }],
  });
  const db = (mode: ModeDef): ContentDatabase => ({ ...c, modes: { ...c.modes, [mode.id]: mode } });
  const live = (mode: ModeDef, ch: Character, conditions: Character['conditions'] = []) =>
    applyPlayState(ch, { ...emptyPlay(), conditions, activeModes: [mode.id] }, db(mode));

  // bug 2026-09-15: modes engine
  it('the condition is on while the mode is on, and gone the moment it is off', () => {
    /*
     * MUTATION PROOF — remove the `content.modes[id]?.conditions` loop from applyPlayState:
     *   AssertionError: the printed enfeebled 1 reaches the sheet: expected undefined to deeply equal
     *     { id: 'enfeebled', value: 1 }
     */
    const mode = enfeebling(1);
    const ch = build('oracle', 5);
    const on = live(mode, ch);
    expect(on.conditions.find((x) => x.id === 'enfeebled'), 'the printed enfeebled 1 reaches the sheet').toEqual({ id: 'enfeebled', value: 1 });
    // Enfeebled is a real number on a real roll, not a badge: −1 to every Strength-based check.
    expect(deriveSkill(on, 'athletics', db(mode)).modifier).toBe(deriveSkill(ch, 'athletics', c).modifier - 1);

    const off = applyPlayState(ch, { ...emptyPlay(), activeModes: [] }, db(mode));
    expect(off.conditions.find((x) => x.id === 'enfeebled'), 'switching the curse off ends it').toBeUndefined();
  });

  // bug 2026-09-15: modes engine
  it('never written into play state, so the toggle can always take it back', () => {
    /*
     * The whole reason it is derived rather than applied: a condition written into `play.conditions`
     * outlives its toggle, and the player is left permanently enfeebled by a curse they switched off.
     *
     * MUTATION PROOF — push into `conditions` instead of rebuilding it (the array starts out as
     * `play.conditions`, so a push writes straight into the player's own list):
     *   AssertionError: the player's own condition list is untouched: expected
     *     [ { id: 'enfeebled', value: 1 } ] to deeply equal []
     */
    const mode = enfeebling(1);
    const play = { ...emptyPlay(), conditions: [], activeModes: [mode.id] };
    const on = applyPlayState(build('oracle', 5), play, db(mode));
    expect(on.conditions.some((x) => x.id === 'enfeebled')).toBe(true);
    expect(play.conditions, "the player's own condition list is untouched").toEqual([]);
  });

  // bug 2026-09-15: modes engine
  it('never downgrades a worse one the player already has', () => {
    /*
     * A GM applying enfeebled 3 and a player switching on a curse worth 1 must not cancel out.
     *
     * MUTATION PROOF — make the merge an unconditional overwrite instead of `(have.value ?? 0) < value`:
     *   AssertionError: the worse condition wins: expected 1 to be 3 // Object.is equality
     */
    const mode = enfeebling(1);
    const worse = live(mode, build('oracle', 5), [{ id: 'enfeebled', value: 3 }]);
    expect(worse.conditions.find((x) => x.id === 'enfeebled')!.value, 'the worse condition wins').toBe(3);
    // …and the mode still RAISES a milder one, which is the other half of "same or higher is kept".
    const milder = live(enfeebling(4), build('oracle', 5), [{ id: 'enfeebled', value: 2 }]);
    expect(milder.conditions.find((x) => x.id === 'enfeebled')!.value).toBe(4);
  });
});

/* ---------------------------------------------------------------------------------------------- *
 * 4 — HUNTER'S BROOCH (finding #113).
 * ---------------------------------------------------------------------------------------------- */

describe("finding #113: the Hunter's Brooch designates ONE weapon", () => {
  /*
   * "Erastil's Steadying Hand" gives deadly d12 to *"one weapon you touch to the symbol"*. The mode's
   * trait rider shipped with an empty `match`, so it landed on every weapon the character wielded — and
   * the record's own note had to ask the player to read the trait on the right one, which is the app
   * handing its job back.
   *
   * `WeaponRider.match.designated` is the field for exactly this and applyWeaponRiders already honours
   * it; what was missing was a designation the brooch could use, and a control to set it.
   */
  const BROOCH_MODE = 'item-hunters-brooch';
  const steadying = (): ModeDef => ({
    ...c.modes[BROOCH_MODE],
    weaponTraits: { match: { designated: 'steadying-hand' }, add: ['deadly-d12'] },
  });
  const inv = (designated: boolean): InventoryItem[] => [
    { instanceId: 'bow', itemId: 'longbow', quantity: 1, equipped: true, ...(designated ? { designations: ['steadying-hand' as const] } : {}) },
    { instanceId: 'sw', itemId: 'longsword', quantity: 1, equipped: true },
    { instanceId: 'br', itemId: STEADYING_HAND_ITEM, quantity: 1, worn: true, invested: true },
  ];
  const ranger = (designated: boolean, modes: ModeDef[]): Character => ({
    ...carrying(build('ranger', 5), inv(designated)),
    activeModes: modes,
  });
  const traitsOf = (ch: Character, instanceId: string) =>
    deriveStrike(ch, c, ch.inventory.find((i) => i.instanceId === instanceId)!)!.traits;

  // bug 2026-09-15: modes engine
  it('the designated weapon gains deadly d12; an undesignated one does not', () => {
    /*
     * MUTATION PROOF — drop the `if (m.designated && …) continue;` line from applyWeaponRiders (the
     * failing assertion is the LONGSWORD, which the rider must never have touched):
     *   AssertionError: an undesignated weapon gains nothing: expected [ 'versatile-p', 'deadly-d12' ]
     *     to not include 'deadly-d12'
     * and, with the designation itself removed from the union, `tsc --noEmit` fails on the match above.
     */
    const on = ranger(true, [steadying()]);
    expect(traitsOf(on, 'bow'), 'the weapon touched to the symbol').toContain('deadly-d12');
    // Deadly d12 REPLACES the longbow's printed deadly d10 rather than sitting beside it.
    expect(traitsOf(on, 'bow')).not.toContain('deadly-d10');
    expect(traitsOf(on, 'sw'), 'an undesignated weapon gains nothing').not.toContain('deadly-d12');

    // …and the whole thing is the mode's: switch the brooch off and the bow is a longbow again.
    const off = ranger(true, []);
    expect(traitsOf(off, 'bow')).not.toContain('deadly-d12');
    expect(traitsOf(off, 'bow')).toContain('deadly-d10');
  });

  // bug 2026-09-15: modes engine
  it('the player can actually SET the mark — it is offered on a weapon, to a brooch owner only', () => {
    /*
     * A rider matched on a designation nobody can set matches nothing, forever. The control is gated the
     * way `rune-source` is: on owning the one record that creates the mark, and on the item being a
     * weapon.
     *
     * MUTATION PROOF — remove the `steadying-hand` push from InventoryTab's designationKinds:
     *   AssertionError: a brooch owner is offered the mark on their bow: expected undefined to be truthy
     */
    expect(c.items[STEADYING_HAND_ITEM], 'the one record that creates this mark').toBeTruthy();
    const char = (owns: boolean): Character =>
      normalizeCharacter({
        id: 'b',
        name: 'B',
        level: 5,
        classId: 'ranger',
        keyAbility: 'dex',
        abilities: { str: 12, dex: 18, con: 14, int: 10, wis: 14, cha: 10 },
        feats: [],
        inventory: owns ? inv(false) : inv(false).filter((i) => i.itemId !== STEADYING_HAND_ITEM),
      } as unknown as Character);

    const mark = (ch: Character, cardName: string) => {
      const r = renderDom(createElement(InventoryTab, { character: ch, content: c, onPlay: noop }));
      const card = [...r.host.querySelectorAll<HTMLElement>('.inv-card')].find((e) => (e.textContent ?? '').includes(cardName));
      expect(card, `no inventory card for ${cardName}`).toBeTruthy();
      r.click(card!);
      const group = [...r.host.querySelectorAll<HTMLElement>('.sd-uses')].find((g) =>
        /this is my/i.test(g.querySelector('.sd-uses-title')?.textContent ?? ''),
      );
      const btn = group
        ? [...group.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === 'Steadying hand weapon')
        : undefined;
      r.stop();
      return btn;
    };

    expect(mark(char(true), 'Longbow'), 'a brooch owner is offered the mark on their bow').toBeTruthy();
    expect(mark(char(false), 'Longbow'), 'a character with no brooch is not asked').toBeUndefined();
    // Not on the brooch itself: the mark names the WEAPON you touched to the symbol, not the symbol.
    expect(mark(char(true), "Hunter's Brooch"), 'the brooch is not its own steadying hand').toBeUndefined();
  });
});

/* ---------------------------------------------------------------------------------------------- *
 * 5 — FORMULA FIELDS.  A number the record cannot know until it meets a character.
 *
 * Eleven of the audit's fixes replaced a wrong constant with a formula string ("resistance equal to
 * half your level", "a fly Speed of 25 feet or your land Speed, whichever is slower"). A formula is
 * only ever as good as its READER: `resolveFormula` lives in derive.ts and does nothing at all on a
 * path whose reader forgot to call it, and the failure is silent and ugly — the raw string, `NaN`, or
 * `[object Object]` printed where a number belongs.
 *
 * So this section does not test resolveFormula. It tests each FIELD KIND's own path end to end, from
 * the seed file to the pixel, and it re-scans all 572 records every run so a sixth field kind cannot
 * appear without a leg.
 * ---------------------------------------------------------------------------------------------- */

describe('a mode’s formula fields resolve to numbers wherever they are read', () => {
  /** Every mode record as SHIPPED FROM SOURCE — the two seed files plus the overlay's create rows.
   *  Read from source, not from `content()`, for the reason modes-vs-print.test.ts states: core.json
   *  is regenerated from these, so a leg that read the generated copy proves nothing about the ship. */
  const seedModes = (): ModeDef[] => [
    ...Object.values(JSON.parse(readFileSync('scripts/data/toggle-modes.json', 'utf8')) as Record<string, ModeDef>),
    ...(JSON.parse(readFileSync('scripts/data/consumable-modes.json', 'utf8')) as ModeDef[]),
    ...(JSON.parse(readFileSync('scripts/data/effect-backfill.json', 'utf8')) as { category: string; create?: boolean; value?: ModeDef }[])
      .filter((r) => r.category === 'modes' && r.create && r.value)
      .map((r) => r.value!),
  ];

  /** Every string-valued NUMERIC leaf, as `<record id>` → `<field kind>`. `[]` stands for an array
   *  index and `*` for a Speed's movement type, so the kinds are countable rather than 76 paths. */
  const formulaFields = (): { id: string; kind: string; value: string }[] => {
    const out: { id: string; kind: string; value: string }[] = [];
    const walk = (node: unknown, path: string, rec: ModeDef) => {
      if (node == null) return;
      if (Array.isArray(node)) return node.forEach((v) => walk(v, `${path}[]`, rec));
      if (typeof node === 'object') {
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, path ? `${path}.${k}` : k, rec);
        return;
      }
      // A numeric field the data may write as arithmetic. Text fields (note, name, appliesWhen…) are
      // full of digits and none of them is ever resolved, so the kind is decided by the PATH.
      if (typeof node === 'string' && /(^|\.)(value|ac)$|speeds\.[a-z]+$/.test(path)) {
        out.push({ id: rec.id, kind: path.replace(/speeds\.[a-z]+$/, 'speeds.*'), value: node });
      }
    };
    for (const r of seedModes()) walk(r, '', r);
    return out;
  };

  /** The kinds that have a leg below. A new one appearing in the data fails the roster leg. */
  const COVERED = ['battleForm.ac', 'battleForm.speeds.*', 'resistances[].value', 'speeds.*', 'weaknesses[].value'];

  const hero = (mode: ModeDef, level: number, over: { ancestryId?: string; classId?: string } = {}): Character => ({
    ...build(over.classId ?? 'fighter', level, { ancestryId: over.ancestryId ?? 'human' }),
    activeModes: [mode],
  });
  const seedMode = (id: string): ModeDef => {
    const m = seedModes().find((x) => x.id === id);
    if (!m) throw new Error(`no seed mode "${id}"`);
    return m;
  };
  /** The three spellings a dead formula reaches the screen as. */
  const UNRESOLVED = /NaN|\[object Object\]|@actor|floor\(|min\(|max\(/;

  // bug 2026-09-15: modes engine
  it('the data carries exactly five formula-bearing field kinds, and this file has a leg for each', () => {
    /*
     * The roster. `modifiers[].value` is DELIBERATELY not on it: `modeNumberBonus` sums those raw and
     * would produce NaN from a string, and the scan says no record writes one — so the missing reader
     * is proved unnecessary rather than assumed so. A record that starts writing one lands here first.
     *
     * MUTATION PROOF — author `modifiers: [{ value: 'floor(@actor.level/2)' }]` on any seed record:
     *   AssertionError: a formula field kind with no leg below: expected [ 'modifiers[].value' ] to
     *     deeply equal []
     */
    const found = formulaFields();
    // Not vacuous: the eleven audit fixes plus the older formulas are really in the seeds.
    expect(found.length).toBeGreaterThanOrEqual(60);
    const kinds = [...new Set(found.map((f) => f.kind))].sort();
    expect(kinds.filter((k) => !COVERED.includes(k)), 'a formula field kind with no leg below').toEqual([]);
    // …and every covered kind is really present, so COVERED cannot rot into a list of dead names.
    expect(kinds).toEqual(COVERED);
  });

  // bug 2026-09-15: modes engine
  it('resistances[].value — half your level is a number in the IWR list, at every level', () => {
    /*
     * item-phoenix-cinder: *"resistance to fire damage equal to half your level"*. deriveDefenses
     * resolves it against the same scope deriveSpeeds uses.
     *
     * MUTATION PROOF — drop `resolveFormula` from deriveDefenses' resistance loop (`const v = r.value`):
     *   AssertionError: half of level 7, floored: expected 'floor(@actor.level/2)' to be 3
     */
    const cinder = seedMode('item-phoenix-cinder');
    expect(cinder.resistances?.[0].value, 'the seed really does carry a formula').toBe('floor(@actor.level/2)');
    const fireAt = (level: number) =>
      deriveDefenses(hero(cinder, level), c).resistances.find((r) => r.type === 'fire')?.value;
    expect(fireAt(7), 'half of level 7, floored').toBe(3);
    expect(fireAt(20)).toBe(10);
    // …and it reaches a pixel as a number, not as the formula or as NaN.
    const pills = renderText(createElement(DefensesPills, { character: hero(cinder, 7), content: c }));
    expect(pills).toContain('Fire 3');
    expect(pills).not.toMatch(UNRESOLVED);
  });

  // bug 2026-09-15: modes engine
  it('weaknesses[].value — a third of your level is a number in the same list', () => {
    /*
     * energetic-meltdown's Moderate Backlash. The weakness loop is a SEPARATE loop from the resistance
     * one, so it is a separate reader and needs its own leg: honouring a formula on only half of one
     * shared shape is how a field goes silently write-only for the other half.
     *
     * MUTATION PROOF — drop `resolveFormula` from deriveDefenses' weakness loop:
     *   AssertionError: a third of level 9: expected undefined to be 3
     */
    const meltdown = seedMode('energetic-meltdown');
    expect(meltdown.weaknesses?.[0].value).toBe('floor(@actor.level/3)');
    const weakAt = (level: number) => deriveDefenses(hero(meltdown, level), c).weaknesses[0]?.value;
    expect(weakAt(9), 'a third of level 9').toBe(3);
    expect(weakAt(20)).toBe(6);
    const pills = renderText(createElement(DefensesPills, { character: hero(meltdown, 9), content: c }));
    expect(pills).toContain(`${meltdown.weaknesses![0].type.replace(/^./, (x) => x.toUpperCase())} 3`);
    expect(pills).not.toMatch(UNRESOLVED);
  });

  // bug 2026-09-15: modes engine
  it('speeds.* — a fly Speed measured against your own land Speed prints feet, not a formula', () => {
    /*
     * item-winged: *"a fly Speed of 25 feet or your land Speed, whichever is slower"*. The mode-Speed
     * loop sits AFTER the base grants in deriveSpeeds precisely so `@actor.speed.land` is known.
     *
     * The dwarf is the control: a constant 25 would pass the human leg and fail this one.
     *
     * MUTATION PROOF — drop `resolveFormula` from the `c.activeModes` Speed loop in deriveSpeeds:
     *   AssertionError: capped at 25, and the human's 25 is the cap: expected undefined to be 25
     */
    const winged = seedMode('item-winged');
    expect(winged.speeds?.fly).toBe('min(25,@actor.speed.land)');
    const human = hero(winged, 5, { ancestryId: 'human' });
    expect(deriveSpeeds(human, c).land, "the human's own land Speed").toBe(25);
    expect(deriveSpeeds(human, c).fly, "capped at 25, and the human's 25 is the cap").toBe(25);
    const dwarf = hero(winged, 5, { ancestryId: 'dwarf' });
    expect(deriveSpeeds(dwarf, c).land).toBe(20);
    expect(deriveSpeeds(dwarf, c).fly, 'the slower of the two, which is the dwarf’s 20').toBe(20);
    // The other direction of the same field kind — "or 20 feet, whichever is GREATER".
    const wyrm = hero(seedMode('item-wyrms-flight'), 5, { ancestryId: 'dwarf' });
    expect(deriveSpeeds(wyrm, c).fly).toBe(20);
    expect(deriveSpeeds(hero(seedMode('item-wyrms-flight'), 5, { ancestryId: 'elf' }), c).fly).toBe(30);

    const rail = renderText(createElement(VitalsRail, { character: human, content: c }));
    expect(rail).toContain('Fly 25 ft');
    expect(rail).not.toMatch(UNRESOLVED);
  });

  // bug 2026-09-15: modes engine
  it('battleForm.speeds.* — the 18th-level dragon flies 120, and the Speed row says so', () => {
    /*
     * A battle form's Speed block SEEDS the Speed object instead of joining the grant loops (it
     * replaces rather than adds), so it is a third, separate reader. spell-1502 prints fly 100 feet and
     * feat dragon-transformation adds *"At 18th level, you gain a +20-foot status bonus to your fly
     * Speed"*.
     *
     * MUTATION PROOF — drop `resolveFormula` from deriveSpeeds' `formSpeeds` branch:
     *   AssertionError: the +20-foot status bonus at 18th: expected undefined to be 120
     */
    const dt = seedMode('dragon-transformation');
    expect(dt.battleForm?.speeds?.fly).toBe('100+20*min(1,floor(@actor.level/18))');
    const at = (level: number) => deriveSpeeds(hero(dt, level, { classId: 'barbarian' }), c).fly;
    expect(at(17), 'the printed 100 feet below 18th level').toBe(100);
    expect(at(18), 'the +20-foot status bonus at 18th').toBe(120);
    const rail = renderText(createElement(VitalsRail, { character: hero(dt, 18, { classId: 'barbarian' }), content: c }));
    expect(rail).toContain('Fly 120 ft');
    expect(rail).not.toMatch(UNRESOLVED);
  });

  // bug 2026-09-15: modes engine
  it('battleForm.ac — the fourth reader, on the fourteen forms that state "AC = N + your level"', () => {
    /*
     * deriveAc has its own call (the form's AC REPLACES the character's, so it cannot share the grant
     * lane). battle-form.test.ts pins critter-shape's 15 + level; this pins that all fourteen resolve,
     * because one unparseable formula resolves to 0 and an AC of 0 is not a loud failure on a sheet.
     *
     * MUTATION PROOF — drop `resolveFormula` from deriveAc's `form?.ac` branch:
     *   AssertionError: a-little-bird-told-me: 30: expected 'a-little-bird-told-me: 0' to be
     *     'a-little-bird-told-me: 30'
     */
    const forms = seedModes().filter((m) => typeof m.battleForm?.ac === 'string');
    expect(forms.length).toBe(14);
    for (const m of forms) {
      const stated = Number(/^(\d+)\+@actor\.level$/.exec(m.battleForm!.ac as string)?.[1]);
      expect(`${m.id}: parses`).toBe(`${Number.isFinite(stated) ? m.id : 'UNREADABLE'}: parses`);
      expect(`${m.id}: ${deriveAc(hero(m, 10), c).value}`).toBe(`${m.id}: ${stated + 10}`);
    }
  });

  // bug 2026-09-15: modes engine
  it('and no record’s formula resolves to nothing — the whole set, swept', () => {
    /*
     * The four legs above each name one record. This one runs EVERY formula-bearing record through the
     * readers at a level where its own ladder is live, because `resolveFormula` returns 0 rather than
     * throwing on anything it cannot parse: one typo'd bracket is a silent resistance 0, a Speed that
     * disappears, or an AC of 0, and no single-record leg would ever see it.
     *
     * MUTATION PROOF — break one seed formula (`floor(@actor.level/2` — a missing bracket):
     *   AssertionError: field-vial-mutagenist resistance physical: expected 0 to be greater than 0
     */
    const byId = new Map(seedModes().map((m) => [m.id, m]));
    const ids = [...new Set(formulaFields().map((f) => f.id))];
    expect(ids.length).toBeGreaterThanOrEqual(50);
    for (const id of ids) {
      const m = byId.get(id)!;
      const ch = hero(m, 20, { classId: 'barbarian' });
      const def = deriveDefenses(ch, c);
      for (const r of def.resistances) expect(`${id} resistance ${r.type}: ${Number.isInteger(r.value) && r.value > 0}`).toBe(`${id} resistance ${r.type}: true`);
      for (const w of def.weaknesses) expect(`${id} weakness ${w.type}: ${Number.isInteger(w.value) && w.value > 0}`).toBe(`${id} weakness ${w.type}: true`);
      for (const [k, v] of Object.entries(deriveSpeeds(ch, c))) {
        expect(`${id} speed ${k}: ${Number.isInteger(v) && (v as number) > 0}`).toBe(`${id} speed ${k}: true`);
      }
      if (m.battleForm?.ac != null) expect(`${id} ac: ${deriveAc(ch, c).value > 0}`).toBe(`${id} ac: true`);
    }
  });
});
