/*
 * Batch 037, WG-comparison lane, chunk data-rows-4.
 *
 * Eleven findings, all authored as overlay rows in work/.b037-rows-data-rows-4.json (the driver
 * applies them to scripts/data/effect-backfill.json). Every assertion here reads public/core.json
 * through `content()` and pins the AUTHORED FIELD, so each test fails until its row lands and keeps
 * failing if a later regeneration drops it — the exact durability check this project keeps needing.
 *
 * Two findings carried NO row when this chunk was written — animal-instinct#spider-web (the
 * granted-attack lane could not hold a damageless attack) and nagaji-spell-familiarity#daily-control
 * (play.ts dropped a rank-0 daily grant, so a granting option would have shipped an empty innate
 * entry). BOTH LANES WERE BUILT LATER IN THE SAME BATCH, by the gap run, and the rows followed. The
 * two guards below therefore assert the fix rather than the gap; each is still a pin against silent
 * growth, naming exactly what is on the lane and the code that carries it.
 *
 * Four of the eleven are fix-pass CHECKS that PASS as shipped (skybearers-belt#scoped-stars,
 * spirit-walk#printed-pieces, and the first three parts each of zealot-staff#printed-contents and
 * mask-of-the-mantis-major#printed-contents). Their tests assert the shipped state rather than a new
 * row — a check that passes still has to be nailed down, or the next pass re-reads it from scratch.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { content } from './_content';
import { FEAT_SITUATIONAL } from '../src/rules/situationalBonuses';

const db = () => content();
const item = (id: string) => db().items[id] as Record<string, unknown> | undefined;
const feat = (id: string) => db().feats[id] as Record<string, unknown> | undefined;
const mode = (id: string) => (db().modes ?? {})[id] as Record<string, unknown> | undefined;

/* ------------------------------------------------------------------ dream-magic: one pick per take */

describe('dream-magic asks its question once per TAKING, not once per character', () => {
  // "Special You can take this feat twice, gaining the spell you didn't select initially the second
  // time." (AoN feat-8518). An effectChoices answer is keyed by RECORD id, so both takings of this
  // maxTakable:2 feat shared one answer; a record `choice` answer is keyed by feat ENTRY.
  // batch 037: dream-magic#second-taking
  it('dream-magic carries its pick on `choice`, not on the shared effectChoices lane', () => {
    expect(feat('dream-magic')?.effectChoices).toBeUndefined();
    const choice = feat('dream-magic')?.choice as { kind: string; distinctAcrossTakes?: boolean; options?: { value: string }[] } | undefined;
    expect(choice?.kind).toBe('array');
    expect(choice?.options?.map((o) => o.value).sort()).toEqual(['dream-message', 'sleep']);
  });

  // "gaining the spell you didn't select initially the second time" (AoN feat-8518) — the shipped
  // lane for a per-taking exclusion is `distinctAcrossTakes`, which greys the other taking's answer
  // (build.ts:2036) and so leaves exactly one selectable option on the second picker.
  // batch 037: dream-magic#second-taking
  it('dream-magic forces the second taking onto the spell the first did not choose', () => {
    expect((feat('dream-magic')?.choice as { distinctAcrossTakes?: boolean })?.distinctAcrossTakes).toBe(true);
  });

  // "you learn this spell as a 4th-rank occult innate spell that you can cast once per day" (AoN
  // feat-8518) — the rank the batch-031 row established must survive the lane move whole.
  // batch 037: dream-magic#second-taking
  it('dream-magic still grants a 4th-rank occult innate spell once per day on each taking', () => {
    const opts = (feat('dream-magic')?.choice as { options?: { value: string; grant?: { innateSpells?: unknown[] } }[] })?.options ?? [];
    expect(opts.length).toBe(2);
    for (const o of opts) {
      expect(o.grant?.innateSpells).toEqual([{ spellId: o.value, tradition: 'occult', rank: 4, usesPerDay: 1 }]);
    }
  });
});

/* ------------------------------------------------- scar-of-the-survivor / soul-well: dying toggles */

describe('scar-of-the-survivor puts its whole Immanence sentence behind a divine-spark toggle', () => {
  // Immanence: "Divine energy spreads outward from your scar, reinforcing your flesh. You gain the
  // benefits of the Diehard feat and a +1 status bonus to Fortitude saving throws." (AoN ikon-13).
  // Both halves are conditional on the spark, so both belong on a toggle — the shape the three
  // shipped immanence modes (aura-mirrored-aegis and its siblings) already use.
  // batch 037: scar-of-the-survivor#dying-toggle
  it('scar-of-the-survivor ships a mode gated on the ikon, with the +1 status Fortitude bonus', () => {
    const m = mode('scar-of-the-survivor');
    expect(m?.feats).toEqual(['scar-of-the-survivor']);
    expect(m?.duration).toMatch(/divine spark/i);
    expect(m?.modifiers).toEqual([
      { value: 1, type: 'status', target: 'save', detail: 'fortitude', appliesWhen: 'while your divine spark is in the scar' },
    ]);
  });

  // The Diehard half has no number to move yet — ModeDef carries no death threshold and build.ts
  // reads `dyingThresholdBonus` only off feats, unconditionally — so it must at least be SAID on the
  // toggle rather than lost with the ungated grant batch 034 retired.
  // batch 037: scar-of-the-survivor#dying-toggle
  it('scar-of-the-survivor names the Diehard clause on the toggle that gates it', () => {
    expect(String(mode('scar-of-the-survivor')?.note ?? '')).toMatch(/dying 5 rather than dying 4/i);
  });
});

describe('soul-well raises the dying value for a minute, not for a career', () => {
  // "For the next minute, incorporeal undead treat all squares within 30 feet of you as difficult
  // terrain and living creatures within the same area die from the dying condition at dying 5 rather
  // than dying 4." (AoN feat-7707). `dyingThresholdBonus` is summed unconditionally into
  // Character.dyingThreshold, so it made a one-minute area effect a permanent personal one.
  // batch 037: soul-well#dying-toggle
  it('soul-well no longer carries the permanent dyingThresholdBonus field', () => {
    expect(feat('soul-well')?.dyingThresholdBonus).toBeUndefined();
  });

  // …and the printed effect keeps a home: the same toggle shape built for scar-of-the-survivor,
  // carrying the one-minute duration print states (AoN feat-7707).
  // batch 037: soul-well#dying-toggle
  it('soul-well ships a one-minute toggle carrying the printed area effect', () => {
    const m = mode('soul-well');
    expect(m?.feats).toEqual(['soul-well']);
    expect(m?.duration).toBe('1 minute');
    expect(String(m?.note ?? '')).toMatch(/dying 5 rather than dying 4/i);
  });
});

/* --------------------------------------------------------- animal-instinct: the damageless Web row */

describe('animal-instinct: the spider Web is on the granted-attack lane, and it is the only damageless row', () => {
  // "The spider's web attack deals no damage, but the target takes a -10-foot circumstance penalty to
  // its Speeds for 1 round on a hit." (AoN instinct-8).
  //
  // THIS FLIPPED INSIDE BATCH 037. When this chunk was written GrantedStrike declared `die` and
  // `damageType` required and build.ts copied both onto the NaturalAttack, so a damageless row would
  // have rendered a Strike with an invented die and the row was deliberately withheld. The gap run
  // then BUILT the lane owner ruling #145 asked for — both fields optional, no die step, no damage
  // riders, "no damage" rendered — and authored the Web. So the guard is no longer "never blank": it
  // is "blank ONLY where print prints no damage", which is this one row.
  // batch 037: animal-instinct#spider-web
  it('animal-instinct — the spider gains Fangs and Web, and no OTHER granted-attack row is blank', () => {
    const spider = ((db().classFeatures['animal-instinct'] as { grantedStrikes?: { name: string; choiceValue?: string }[] }).grantedStrikes ?? [])
      .filter((s) => s.choiceValue === 'spider');
    expect(spider.map((s) => s.name)).toEqual(['Fangs', 'Web']);
    const blank: string[] = [];
    for (const [bucket, records] of Object.entries(db() as unknown as Record<string, Record<string, { grantedStrikes?: { name: string; die?: string; damageType?: string }[] }>>)) {
      if (!records || typeof records !== 'object') continue;
      for (const [id, rec] of Object.entries(records)) {
        for (const g of rec?.grantedStrikes ?? []) {
          if (!g.die || !g.damageType) blank.push(`${bucket}/${id}/${g.name}`);
        }
      }
    }
    expect(blank).toEqual(['classFeatures/animal-instinct/Web']);
  });
});

/* -------------------------------------------------------------- merchants-scale: print says nothing */

describe("merchants-scale carries the printed entry, and nothing print does not print", () => {
  // The whole printed entry is "Merchant's Scale Source Player Core pg. 290 Price 2 sp Hands 2 Bulk L"
  // (AoN equipment-2734) — there is no rules body. The record shipped an empty description, so the
  // sheet opened a blank popup and nothing said why.
  //
  // CLOSER NOTE. Owner ruling 2026-09-10 #17 asked for one line marked as ours ("Heroes Heaven note
  // (not printed text)…"), and the apply stage's pre-check 5 refuses any description token that is in
  // neither our current text nor the mirror — the guard that stops a batch inventing prose cannot tell
  // an honest marker from invented flavour. So the row that shipped is print's own entry restated; the
  // marker wording, and the 243 other items with an empty description, are queued for the owner as
  // work/.b037-queue.json#empty-description-marker-line. This asserts the shipped shape, not the
  // unbuildable one.
  // batch 037: merchants-scale#no-rules
  it('merchants-scale carries the printed entry and no invented bonus', () => {
    const desc = String(item('merchants-scale')?.description ?? '');
    expect(desc).toMatch(/Price 2 sp/);
    expect(desc).toMatch(/Bulk L/);
    // Nothing the book does not print: no rules body, and none of Wanderer's Guide's invented +1 item
    // bonus to seven skills.
    expect(desc).not.toMatch(/item bonus/i);
    expect(item('merchants-scale')?.passiveEffects).toBeUndefined();
    expect(FEAT_SITUATIONAL['merchants-scale']).toBeUndefined();
  });
});

/* ------------------------------------------------------- mask-of-the-mantis-major: printed contents */

describe('mask-of-the-mantis-major carries every piece its own block prints', () => {
  // "The item bonus to Perception and Intimidation is +3." and "Activate-Locate Target Two Actions 10
  // minutes (concentrate) Frequency once per day; Effect You cast pinpoint." (AoN equipment-3497-3391).
  // The Major block never restates the Greater's 5th-rank heightening, so both Enhance Vision spells
  // stay at the base 2nd rank — follow the archive literally.
  // batch 037: mask-of-the-mantis-major#printed-contents
  it('mask-of-the-mantis-major keeps Enhance Vision at rank 2 and Locate Target once per day', () => {
    const held = item('mask-of-the-mantis-major')?.heldSpells as Record<string, string[]>;
    expect(held['2'].slice().sort()).toEqual(['darkvision', 'see-the-unseen']);
    expect(held['5']).toBeUndefined();
    expect(held['8']).toEqual(['pinpoint']);
    // The Greater grade is the one that prints the 5th-rank heightening; it must not have moved.
    expect((item('mask-of-the-mantis-greater')?.heldSpells as Record<string, string[]>)['5'].slice().sort()).toEqual(['darkvision', 'see-the-unseen']);
    expect((item('mask-of-the-mantis-major')?.passiveEffects as Record<string, number>).perception).toBe(3);
  });

  // "as long as Vernai's Ire remains active, you gain a +3 item bonus to Intimidation checks" (AoN
  // equipment-3497-3391). Switched on and off by an activation and gated on Vernai membership, so it
  // is an item mode — ItemDetail renders one as the item's Activate control — and never a passive.
  // The cost is the page's: "Activate—Vernai's Ire Two Actions (concentrate)".
  // batch 037: mask-of-the-mantis-major#printed-contents
  it("mask-of-the-mantis-major carries Vernai's Ire as an item mode worth +3 item to Intimidation", () => {
    const m = mode('item-mask-of-the-mantis-major');
    expect(m?.fromItemId).toBe('mask-of-the-mantis-major');
    expect(m?.modifiers).toEqual([{ value: 3, type: 'item', target: 'skill', detail: 'intimidation' }]);
    expect(String(m?.note ?? '')).toMatch(/member of the Vernai/i);
    expect(String(m?.note ?? '')).toMatch(/Two Actions/);
    expect(String(m?.note ?? '')).not.toMatch(/One action/i);
  });

  /*
   * …and the TEXT the player reads has to say the same thing the data does. The shipped description
   * said "You cast either a 5th-rank Darkvision or See the Unseen", which is the GREATER block's
   * heightening ("When you Enhance Vision, the darkvision spell or see the unseen spell is heightened
   * to 5th-rank") printed onto the Major — contradicting, on the same item card, the rank-2 heldSpells
   * the owner ruling keeps. It also carried the one-action glyph on Vernai's Ire and no glyph at all
   * on Locate Target, where the page prints Two Actions for both.
   */
  // batch 037: mask-of-the-mantis-major#printed-contents
  it('mask-of-the-mantis-major description matches its own block: no 5th-rank, Two Actions on both activations', () => {
    const d = String(item('mask-of-the-mantis-major')?.description ?? '');
    expect(d).toMatch(/You cast either Darkvision or See the Unseen on yourself/);
    expect(d).not.toMatch(/5th-rank/);
    expect(d).toMatch(/\*\*Activate—Vernai's Ire\*\* ⟨2⟩/);
    expect(d).toMatch(/\*\*Activate—Locate Target\*\* ⟨2⟩ 10 minutes/);
    // The Greater grade is the one whose block prints the heightening; its text keeps it.
    expect(String(item('mask-of-the-mantis-greater')?.description ?? '')).toMatch(/5th-rank/);
  });
});

/* ------------------------------------------------------------------------ zealot-staff: two findings */

describe('zealot-staff prints no Frequency on its free action', () => {
  // "Activate Free Action (concentrate) Trigger You hit with a Strike using the staff; Effect A
  // vicious blast of deific power explodes as you hit." (AoN equipment-2263). The page has no
  // Frequency line at all, so the once-per-minute limit and its pip tracked a cadence no source prints.
  // batch 037: zealot-staff#free-action-limit
  it('zealot-staff carries no frequency and no per-minute counter, only its charge pool', () => {
    expect(item('zealot-staff')?.frequency).toBeUndefined();
    expect(item('zealot-staff')?.counters).toEqual([
      { id: 'pool', label: 'Charges', max: 'level', resetsOnRest: true, startsFull: true },
    ]);
  });

  /*
   * …and the sentence the player READS has to lose it too. The finding's premise was that Foundry's
   * once-per-10-minutes "never reaches a player in this app"; the shipped description said, verbatim,
   * "**Frequency** once per 10 minutes", and tagged the activation "(concentrate, sanctified, spirit)"
   * where the page prints only "(concentrate)". Removing the field and the pip while leaving that on
   * the item card would have kept the whole visible half of the defect.
   */
  // batch 037: zealot-staff#free-action-limit
  it('zealot-staff description prints no Frequency and only the printed trait', () => {
    const d = String(item('zealot-staff')?.description ?? '');
    expect(d).toMatch(/\*\*Activate\*\* ⟨4⟩ \(concentrate\)/);
    expect(d).not.toMatch(/once per 10 minutes/i);
    expect(d).not.toMatch(/sanctified/i);
    // …and everything the page DOES print on that activation is still there.
    expect(d).toMatch(/\*\*Trigger\*\* You hit with a Strike using the staff/);
    expect(d).toMatch(/additional 1d4 spirit damage per damage die/);
    expect(d).toMatch(/you become Drained 1 until your next daily preparations/);
  });
});

describe('zealot-staff is the weapon its page says it is', () => {
  // "Used as a weapon, the staff is a +3 greater striking staff." (AoN equipment-2263). The record
  // shipped a bare 1d4 club with no runes, so the Strike carried neither the +3 nor the extra dice.
  // batch 037: zealot-staff#printed-contents
  it('zealot-staff is a +3 greater striking staff', () => {
    expect(item('zealot-staff')?.builtInRunes).toEqual({ potency: 3, striking: 'greater' });
  });

  // "Cantrip Divine Lance - 1st Bane - 2nd Augury - 3rd Warding Aggression - 4th Divine Wrath - 5th
  // Crisis of Faith, Divine Wrath - 6th Spiritual Armament, Zealous Conviction - 7th Crisis of Faith,
  // Divine Decree" (AoN equipment-2263). The check half of the finding: the ladder must not drift.
  // batch 037: zealot-staff#printed-contents
  it('zealot-staff holds the printed spell list at the printed ranks', () => {
    expect(item('zealot-staff')?.heldSpells).toEqual({
      '0': ['divine-lance'],
      '1': ['bane'],
      '2': ['augury'],
      '3': ['warding-aggression'],
      '4': ['divine-wrath'],
      '5': ['crisis-of-faith', 'divine-wrath'],
      '6': ['spiritual-armament', 'zealous-conviction'],
      '7': ['crisis-of-faith', 'divine-decree'],
    });
  });
});

/* ---------------------------------------------------------------------- skybearers-belt: scoped stars */

describe('skybearers-belt scopes its three stars to the four named actions', () => {
  // "You can attempt to Disarm, Grapple, Shove, or Trip creatures up to two sizes larger than you, and
  // you gain a +1 circumstance bonus to checks for these actions and to your saving throws to resist
  // these actions." (AoN ikon-16). Grapple and Shove are resisted with Fortitude, Disarm and Trip with
  // Reflex, so the two save stars between them cover "these actions" and nothing wider.
  // batch 037: skybearers-belt#scoped-stars
  it('skybearers-belt stars name the four actions and never sit blanket on a stat', () => {
    const rows = FEAT_SITUATIONAL['skybearers-belt'] ?? [];
    expect(rows.length).toBe(3);
    for (const r of rows) {
      expect(r.bonus).toBe('+1 circumstance');
      expect(r.when).toMatch(/Disarm|Grapple|Shove|Trip/);
      expect(r.when).toMatch(/divine spark/i);
    }
    expect(rows.map((r) => r.targets.map((t) => `${t.kind}:${'detail' in t ? t.detail : ''}`).join()).sort()).toEqual([
      'save:fortitude',
      'save:reflex',
      'skill:athletics',
    ]);
  });

  // "…creatures up to two sizes larger than you" — the permission is half the printed sentence and has
  // no stat to sit on, so the player only ever gets it from the record's own text (AoN ikon-16).
  // batch 037: skybearers-belt#scoped-stars
  it('skybearers-belt shows the two-sizes-larger permission to the player', () => {
    expect(String((db().classFeatures['skybearers-belt'] as { description?: string })?.description ?? '')).toMatch(/two sizes larger/i);
    expect((db().classFeatures['skybearers-belt'] as { grantsClassFeatures?: string[] })?.grantsClassFeatures).toEqual(['bear-allies-burdens']);
  });
});

/* ------------------------------------------------------------------------ spirit-walk: printed pieces */

describe('spirit-walk carries its three printed pieces and no sense clause', () => {
  // "You and allies in a 30-foot emanation gain a +2 status bonus to Recall Knowledge checks about
  // spirits, haunts, and undead. While you're Searching or Detecting Magic in exploration mode, this
  // bonus also applies to AC and saves against reactions any of you trigger from haunts and spirits."
  // (AoN feat-7137). Print names no sense on this feat — apparition sight is Apparition Sense's.
  // batch 037: spirit-walk#printed-pieces
  it('spirit-walk carries the Recall Knowledge star and the exploration AC/save stars', () => {
    const rows = FEAT_SITUATIONAL['spirit-walk'] ?? [];
    expect(rows.length).toBe(3);
    for (const r of rows) expect(r.bonus).toBe('+2 status');
    const kinds = rows.map((r) => r.targets.map((t) => `${t.kind}:${'detail' in t ? t.detail : ''}`).join()).sort();
    expect(kinds).toEqual(['ac:', 'save:all', 'skill:all']);
    expect(rows.find((r) => r.targets[0].kind === 'skill')?.when).toMatch(/Recall Knowledge/i);
    for (const r of rows.filter((x) => x.targets[0].kind !== 'skill')) {
      expect(r.when).toMatch(/Searching or Detecting Magic in exploration mode/i);
    }
    // No sense clause is printed on this feat, so none is authored onto it.
    expect(feat('spirit-walk')?.senses).toBeUndefined();
  });

  // "During your first turn in an encounter, you and allies in the aura have resistance equal to half
  // your level against damage dealt by haunts or spirits." (AoN feat-7137) — built in batch 036; the
  // third printed piece is pinned here so this finding's check covers all three.
  // batch 037: spirit-walk#printed-pieces
  it('spirit-walk keeps the first-turn haunt/spirit resistance at half level', () => {
    expect(feat('spirit-walk')?.resistances).toEqual([
      {
        type: 'all',
        value: 'floor(@actor.level/2)',
        against: 'damage dealt by haunts or spirits, during your first turn in an encounter (you and allies in the 30-foot aura)',
      },
    ]);
  });
});

/* --------------------------------------------------------- nagaji-spell-familiarity: one live control */

describe('nagaji-spell-familiarity keeps its daily question, and now grants through it', () => {
  /*
   * "During your daily preparations, choose daze, detect magic, or mage hand. Until your next daily
   * preparations, you can cast the chosen spell as an occult innate cantrip." (AoN feat-3984; mage
   * hand is now Telekinetic Hand).
   *
   * THIS FLIPPED INSIDE BATCH 037, the same way the spider Web above did. When this chunk was written
   * the options were deliberately grant-less because play.ts's daily-grant block dropped a rank-0
   * spell outright (`const rank = content.spells[b.spellId].rank ?? 0; if (rank <= 0) continue;`), so
   * a granting option would have handed the player an EMPTY "Innate spells" card. The gap run built
   * the rank-0 route — a cantrip now lands in the entry's `cantrips` list, where it auto-heightens —
   * and authored the grants. So the guard is no longer "no rank-0 daily grant anywhere": it is the pin
   * against silent growth, naming the six that exist and the route that carries them.
   */
  // batch 037: nagaji-spell-familiarity#daily-control
  it('nagaji-spell-familiarity asks the printed question, and every rank-0 daily answer has a route through play.ts', () => {
    const choice = feat('nagaji-spell-familiarity')?.choice as
      | { daily?: boolean; options?: { value: string; grant?: unknown }[] }
      | undefined;
    expect(choice?.daily).toBe(true);
    expect(choice?.options?.map((o) => o.value)).toEqual(['daze', 'detect-magic', 'telekinetic-hand']);
    const rank0: string[] = [];
    const db2 = db() as unknown as Record<string, Record<string, { choice?: { daily?: boolean; options?: { grant?: { innateSpells?: { spellId: string }[] } }[] } }>>;
    for (const [bucket, records] of Object.entries(db2)) {
      if (!records || typeof records !== 'object') continue;
      for (const [id, rec] of Object.entries(records)) {
        if (!rec?.choice?.daily) continue;
        for (const o of rec.choice.options ?? []) {
          for (const s of o.grant?.innateSpells ?? []) {
            const sp = db().spells[s.spellId];
            if (sp && (sp.rank ?? 0) <= 0) rank0.push(`${bucket}/${id}:${s.spellId}`);
          }
        }
      }
    }
    expect(rank0.sort()).toEqual([
      'feats/kitsune-spell-familiarity:daze',
      // Ghost Sound (spell-132) is superseded; its current printing is Figment (spell-1528), which is
      // what the grant names — the option's answer key is still the printed word "ghost-sound".
      'feats/kitsune-spell-familiarity:figment',
      'feats/kitsune-spell-familiarity:forbidding-ward',
      'feats/nagaji-spell-familiarity:daze',
      'feats/nagaji-spell-familiarity:detect-magic',
      'feats/nagaji-spell-familiarity:telekinetic-hand',
    ]);
    /* …and the route those six need really is in the tree: without this branch every one of them is
     * dropped again and the six options above become silent. */
    expect(readFileSync(join(__dirname, '../src/rules/play.ts'), 'utf8')).toContain('if (!cantrips.includes(b.spellId)) cantrips.push(b.spellId);');
  });
});
