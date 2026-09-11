import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import type { BuildState } from '../src/rules/build';
import type { SpellNote } from '../src/rules/types';

/**
 * BATCH 037, data-rows chunk 2 — the eleven WG-comparison findings this chunk owns.
 *
 * Every assertion here reads the SHIPPED data through `content()` (public/core.json merged with
 * public/core-descriptions.json, exactly as the app loads it), because each fix is an overlay row in
 * scripts/data/effect-backfill.json that the batch driver applies. Two findings — locate-lawbreakers
 * and oatia-skysage-dedication — are deliberately untested: both need a reader that does not exist
 * yet, so there is no authored field to pin and pinning today's state would pin the defect. They are
 * written up under CROSS-FILE GAPS in work/.b037-report-data-rows-2.txt instead.
 */
const db = content();

/** An item's resonant clause, with the `spellNotes` member this batch adds. */
const resonantOf = (id: string) =>
  (db.items[id] as unknown as { resonant?: { note: string; spellNotes?: SpellNote[] } }).resonant;

describe('backgrounds/sponsored-by-teacher-ot asks its one printed pick once', () => {
  /*
   * *"You're trained in your choice of the Survival or Performance skill. You gain a skill feat:
   * Survey Wildlife if you chose Survival or Impressive Performance if you chose Performance."*
   * ONE answer decides both halves; the record carried a second control (a `choice` with flag
   * `bgSkill`) asking the same question, and answering the two differently trained two skills.
   */
  // batch 037: sponsored-by-teacher-ot#one-pick
  it('carries no duplicate `choice` control beside its trainedSkillChoice', () => {
    const rec = db.backgrounds['sponsored-by-teacher-ot'];
    expect(rec.trainedSkillChoice, 'the surviving control').toEqual(['survival', 'performance']);
    expect(rec.choice, 'the second control the player could answer differently').toBeUndefined();
  });

  /* The mechanic the surviving control drives, on a BUILT character — the guard that the deletion
   * removed a duplicate rather than the working half. Passes before the row lands as well as after;
   * the assertion above is the one that flips. */
  // batch 037: sponsored-by-teacher-ot#one-pick
  it('the single answer drives both the training and the feat', () => {
    for (const [pick, feat] of [
      ['survival', 'survey-wildlife'],
      ['performance', 'impressive-performance'],
    ] as const) {
      const c = build('fighter', 1, {
        backgroundId: 'sponsored-by-teacher-ot',
        backgroundSkillChoice: pick,
      } as Partial<BuildState>);
      expect(c.proficiencies.skills[pick], `${pick}: not trained`).toBeTruthy();
      expect(c.feats.map((f) => f.featId), `${pick}: wrong feat`).toContain(feat);
    }
  });
});

describe('backgrounds/streetfood-vendor prints the current Tian Xia sentence', () => {
  /*
   * Tian Xia Character Guide pg. 11 (the current page): *"You're trained in your choice of either the
   * Crafting or Society skill, as well as the Cooking Lore skill. You gain the Seasoned skill feat."*
   * Ours had been rewritten to "trained in either Crafting or Society, and Cooking Lore".
   * The mirror doc background-479 is STALE and must not be used to re-derive this record.
   */
  // batch 037: streetfood-vendor#printed-choice
  it('states the printed sentence verbatim, and keeps the Crafting-or-Society pick', () => {
    const rec = db.backgrounds['streetfood-vendor'];
    expect(rec.description).toContain(
      "You're trained in your choice of either the Crafting or Society skill, as well as the Cooking Lore skill. You gain the Seasoned skill feat.",
    );
    expect(rec.description, 'our rewrite must be gone').not.toContain("You're trained in either Crafting or Society");
    expect(rec.trainedSkillChoice).toEqual(['crafting', 'society']);
  });
});

describe('items/aeon-stone-agate-ellipsoid prints its resonant clause on Augury', () => {
  /* equipment-407-868: *"The resonant power causes the augury spell from the aeon stone to always
   * succeed at the DC 6 flat check to give an answer other than \"nothing.\""* — a rule about the
   * granted spell that could only be found by opening the item. */
  // batch 037: aeon-stone-agate-ellipsoid#resonant-note
  it('carries the clause on the augury entry as well as on the item', () => {
    const res = resonantOf('aeon-stone-agate-ellipsoid');
    expect(res?.note).toContain('always succeed at the DC 6 flat check');
    const on = (res?.spellNotes ?? []).find((n) => n.spellId === 'augury');
    expect(on, 'the granted Augury carries no resonant clause').toBeDefined();
    expect(on!.note, 'the spell-side clause must be the item-side clause').toBe(res!.note);
  });
});

describe('items/aeon-stone-dusty-rose-prism prints its resonant clause on Shield, once', () => {
  /* equipment-407-870: *"The resonant power increases the damage prevented by your aeon stone's
   * shield spell from 5 to 10."* */
  // batch 037: aeon-stone-dusty-rose-prism#resonant-note
  it('carries the 5-to-10 clause on the shield entry', () => {
    const res = resonantOf('aeon-stone-dusty-rose-prism');
    const on = (res?.spellNotes ?? []).find((n) => n.spellId === 'shield');
    expect(on, 'the granted Shield carries no resonant clause').toBeDefined();
    expect(on!.note).toBe(res!.note);
    expect(on!.note).toContain('from 5 to 10');
  });

  /* One printed condition (slotted in a wayfinder) means one control. This stone alone carried BOTH
   * the universal `wayfinder-slotted` inventory mark and an older per-item yes/no picker asking the
   * same thing, and the two could be set to disagree. */
  // batch 037: aeon-stone-dusty-rose-prism#duplicate-picker
  it('no longer carries the duplicate yes/no resonant picker', () => {
    const rec = db.items['aeon-stone-dusty-rose-prism'] as unknown as { effectChoices?: { id?: string }[] };
    expect(rec.effectChoices, 'the wayfinder mark is the only control').toBeUndefined();
    /* …and the mark itself still has something to gate: the reader at build.ts:8088 fires on
     * `resonant`, so deleting the picker must not have taken the power with it. */
    expect(resonantOf('aeon-stone-dusty-rose-prism')).toBeDefined();
  });
});

describe('items/aeon-stone-western-star prints its resonant clause on Illusory Disguise', () => {
  /* equipment-407-874: *"The resonant power allows you to render all of your aeon stones and your
   * wayfinder invisible whenever you use the activation to gain the effects of illusory disguise."* */
  // batch 037: aeon-stone-western-star#resonant-note
  it('carries the invisibility clause on the illusory disguise entry', () => {
    const res = resonantOf('aeon-stone-western-star');
    const on = (res?.spellNotes ?? []).find((n) => n.spellId === 'illusory-disguise');
    expect(on, 'the granted Illusory Disguise carries no resonant clause').toBeDefined();
    expect(on!.note).toBe(res!.note);
    expect(on!.note).toContain('render all of your aeon stones and your wayfinder invisible');
  });
});

describe('feats/wild-lights keeps the printed spell name Dancing Lights', () => {
  /*
   * feat-3375: *"When you cast dancing lights , you can modify its duration to be 1 minute…"*. The
   * import rewrote the printed spell name to Light — which is wrong against our Light and invisible
   * to the player, because the prerequisites still read "ability to cast dancing lights".
   */
  // batch 037: wild-lights#printed-spell-name
  it('says Dancing Lights, not Light, and links to neither', () => {
    const rec = db.feats['wild-lights'];
    expect(rec.description).toContain('When you cast Dancing Lights,');
    expect(rec.description, 'the import-time rewrite').not.toContain('When you cast Light,');
    /* Emptied rather than removed: a prose row is replayed to core-descriptions.json only when its
     * value is an array (scripts/apply-backfill-now.mjs:72), so `null` would reach neither file. `[]`
     * is what every reader already treats as no links — each tests `descRefs?.length` or maps it. */
    expect(rec.descRefs, 'the import-time link to a spell this feat does not modify').toEqual([]);
  });

  /* One line marked as ours — on the record's own `note`, the app's own-voice lane, which renders as
   * "Note: …" under the feat on a built character (src/sheet/FeatsTab.tsx:131). NOT inside the
   * description: a description row may carry only PRINT, and the batch driver's pre-check refuses one
   * that introduces words absent from both our text and the cited mirror doc
   * (scripts/wg-batch-run.mjs:682-694). And NO mechanical rider on Light, the other half of the ruling. */
  // batch 037: wild-lights#printed-spell-name
  it('states the replacement as ours and puts no rider on Light', () => {
    const rec = db.feats['wild-lights'];
    expect(rec.note).toBe(
      "Dancing Lights is a legacy spell that the Remaster replaced with Light. This feat's modification is printed for Dancing Lights and is not applied to Light.",
    );
    expect(rec.description, 'our voice stays out of the printed text').not.toContain('Remaster');
    const onLight = (Object.values(db.feats) as { id: string; spellNotes?: SpellNote[] }[]).filter((f) =>
      (f.spellNotes ?? []).some((n) => n.spellId === 'light'),
    );
    expect(onLight.map((f) => f.id), 'no feat may write a rider onto Light from this ruling').not.toContain('wild-lights');
  });
});

describe('feats/toppling-tentacles reaches Black Tentacles and Slither', () => {
  /*
   * feat-3391: *"When you cast black tentacles , replace the spell's standard effects with the
   * following…"*. The feat IS a spell modification and it reached no spell page: Black Tentacles is
   * edition `superseded`, and Slither — the spell the archive records as its replacement — carried
   * nothing.
   */
  // batch 037: toppling-tentacles#replacement-note
  it('writes its replacement clause onto both spells', () => {
    const notes = db.feats['toppling-tentacles'].spellNotes ?? [];
    expect(notes.map((n) => n.spellId).sort()).toEqual(['black-tentacles', 'slither']);
    const bt = notes.find((n) => n.spellId === 'black-tentacles')!;
    expect(bt.note, 'the printed spell name stays intact').toContain('When you cast Black Tentacles,');
    const sl = notes.find((n) => n.spellId === 'slither')!;
    expect(sl.note, 'the replacement must say where the clause is printed').toContain(
      'Printed for Black Tentacles, which Slither replaced.',
    );
    /* Both must actually ship, or `pushSpellNote` drops the clause and it renders nowhere. */
    for (const id of ['black-tentacles', 'slither']) expect(db.spells[id], `${id} is not in core.spells`).toBeTruthy();
  });

  /* feat-3391 prints "takes 3d6 bludgeoning damage" and "deal 1d6 bludgeoning damage"; our stored
   * copy had lost the damage type from both lines at import, so the whole feat named none. */
  // batch 037: toppling-tentacles#replacement-note
  it('names the bludgeoning damage print states, in the note and on the feat', () => {
    const notes = db.feats['toppling-tentacles'].spellNotes ?? [];
    for (const text of [db.feats['toppling-tentacles'].description ?? '', ...notes.map((n) => n.note)]) {
      expect(text).toContain('takes 3d6 bludgeoning damage');
      expect(text).toContain('deal 1d6 bludgeoning damage');
    }
  });
});

describe('feats/spew-tentacles reaches Black Tentacles and Slither', () => {
  /*
   * feat-2531: *"You can cast black tentacles once per day as an innate occult spell, though when you
   * do so, you spew them from your mouth…"*. Same defect as its sibling: the clause was keyed only to
   * the hidden Black Tentacles, while the feat's own grant was overlaid to Slither.
   */
  // batch 037: spew-tentacles#replacement-note
  it('writes its clause onto the replacement spell it actually grants', () => {
    const rec = db.feats['spew-tentacles'];
    const notes = rec.spellNotes ?? [];
    expect(notes.map((n) => n.spellId).sort()).toEqual(['black-tentacles', 'slither']);
    expect(notes.find((n) => n.spellId === 'slither')!.note).toContain('Printed for Black Tentacles, which Slither replaced.');
    /* The grant and the clause must name the same spell — a note on a spell the feat does not grant
     * is exactly the state this finding describes. */
    expect((rec.innateSpells ?? []).map((g) => g.spellId)).toContain('slither');
  });
});
