import { describe, it, expect } from 'vitest';
import {
  RECORD_MARKERS,
  SPELL_MARKERS,
  SITUATIONAL_SUPERSEDES,
  FEAT_SITUATIONAL,
  markersFor,
  spellMarkersFor,
  supersededIds,
} from '../src/rules/situationalBonuses';
import { explainStat, recordMarkersFor, saveDcHasSituational, spellSituationalFor, statHasSituational } from '../src/rules/explain';
import { SKILL_ACTIONS, skillActionsFor } from '../src/rules/skillActions';
import { ACTIVITIES } from '../src/rules/actions';
import type { Character, ContentDatabase } from '../src/rules/types';
import { content, build } from './_content';

const c = () => content();
/** A character holding exactly one situational source, whatever collection it lives in. */
const withSource = (id: string, over: Partial<Character> = {}): Character => ({
  ...build('fighter', 5),
  feats: [{ featId: id, level: 1, source: 'class' }],
  ...over,
});

describe('D — the mark goes on the action it changes', () => {
  it('Magic Hands marks Treat Wounds and shows the changed die', () => {
    // The owner's own worked example: "Magic Hands show the d10 in () in the treat wounds action".
    const marks = recordMarkersFor(withSource('magic-hands'), c(), 'action', 'treat-wounds');
    expect(marks).toHaveLength(1);
    expect(marks[0].value).toBe('d10');
    expect(marks[0].note).toBeTruthy();
  });

  it('Black Powder Boost marks Leap with its +10 feet', () => {
    const marks = recordMarkersFor(withSource('black-powder-boost'), c(), 'action', 'leap');
    expect(marks[0]?.value).toBe('+10 feet');
  });

  it('the mark is on the action, NOT on the skill the action uses', () => {
    // The whole reason this surface exists: Magic Hands gives no bonus to the Medicine check at all,
    // so starring Medicine would claim something the feat does not grant.
    expect(statHasSituational(withSource('magic-hands'), { kind: 'skill', skill: 'medicine' }, c())).toBe(false);
  });

  it('a character without the feat gets no mark', () => {
    expect(recordMarkersFor(build('fighter', 5), c(), 'action', 'treat-wounds')).toEqual([]);
  });

  it('every marked action or condition exists in the shipped data', () => {
    // A marker pointing at an id nothing renders would land nowhere at all.
    //
    // ⚠ `content.actions` is not the only source of an action ROW. MainTab also lists every feat that
    // carries a non-passive `actionCost` (MainTab.tsx:260) and marks it with the slug of its NAME, the
    // same slug used here — so Vicious Swing is a real row despite being a feat rather than an
    // `actions` record. Checking only `content.actions` would have rejected a marker that renders.
    const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const featRows = new Set(
      Object.values(c().feats)
        .filter((f) => f.actionCost && f.actionCost.type !== 'passive')
        .map((f) => slug(f.name)),
    );
    const missing: string[] = [];
    for (const [source, marks] of Object.entries(RECORD_MARKERS)) {
      for (const m of marks) {
        // 'feature' is the third surface (situationalBonuses.ts RecordMarker): a feat or class-feature
        // ENTRY on the Feats tab, for a rule printed inside another record's prose. Its ids live in
        // feats/classFeatures, so the two-bucket ternary sent every one of them to `conditions` and
        // reported a live marker as missing.
        const bucket =
          m.on === 'action' ? c().actions : m.on === 'condition' ? c().conditions : { ...c().feats, ...c().classFeatures };
        if ((bucket as Record<string, unknown>)[m.id]) continue;
        if (m.on === 'action' && featRows.has(m.id)) continue;
        missing.push(`${source} → ${m.on}/${m.id}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('markersFor does not leak between surfaces', () => {
    // `dying` is a condition; asking for an action of that name must find nothing.
    expect(markersFor(['the-survivor'], 'condition', 'dying').length).toBeGreaterThan(0);
    expect(markersFor(['the-survivor'], 'action', 'dying')).toEqual([]);
  });
});

describe('D — the mark goes on the condition it changes', () => {
  it('The Survivor marks the Dying condition', () => {
    // The owner's third worked example: "The Survivor add a * on the dying condition".
    const marks = recordMarkersFor(withSource('the-survivor'), c(), 'condition', 'dying');
    expect(marks).toHaveLength(1);
    expect(marks[0].note).toBeTruthy();
  });
});

describe('D — a bonus that moves the DC, not your roll', () => {
  const sixfingers = () => {
    const ch = build('fighter', 5);
    return { ...ch, inventory: [{ instanceId: 'i1', itemId: 'sixfingers-elixir-lesser', quantity: 1, invested: true }] };
  };

  it('the save DC is starred, and the save name is not', () => {
    // A Disarm is rolled by your OPPONENT against your Reflex DC. Starring "Reflex" would promise a
    // bonus to a save you roll, which this gives you none of.
    const ch = sixfingers();
    expect(saveDcHasSituational(ch, 'reflex', c())).toBe(true);
    expect(statHasSituational(ch, { kind: 'save', save: 'reflex' }, c())).toBe(false);
  });

  it('the entry is still readable in the save popup, and says which number it moves', () => {
    const lines = (explainStat(sixfingers(), c(), { kind: 'save', save: 'reflex' }).situational ?? []).map((s) => s.text);
    expect(lines.join(' ')).toMatch(/raises the DC others roll against/);
  });

  it('a save with no DC-only bonus is not starred on its DC', () => {
    expect(saveDcHasSituational(sixfingers(), 'will', c())).toBe(false);
  });

  it('dcOnly is only ever set on a target that HAS a DC', () => {
    const bad: string[] = [];
    for (const [id, list] of Object.entries(FEAT_SITUATIONAL)) {
      for (const b of list) {
        for (const t of b.targets) {
          if (t.dcOnly && t.kind !== 'save' && t.kind !== 'spell') bad.push(`${id}: dcOnly on ${t.kind}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('F — a bonus that lands on someone else', () => {
  const itemModes = () => Object.values(c().modes).filter((m) => m.fromItemId);

  it('the activator gets a display-only pill for a timed ally effect', () => {
    // "if its active to a limited to an amount of time then add mode to the user that activated the
    // thing that let the user kniows its activbe but it wint actually do anything"
    const ally = itemModes().filter((m) => m.modifiers.length === 0 && m.note);
    expect(ally.length).toBeGreaterThan(0);
  });

  it('an ally mode changes none of your numbers', () => {
    // The definition of display-only. A single modifier would move a stat that is not yours to move.
    const paradigm = itemModes().find((m) => m.fromItemId === 'paradigm-cube');
    expect(paradigm).toBeTruthy();
    expect(paradigm!.modifiers).toEqual([]);
    expect(paradigm!.note).toBeTruthy();
    expect(paradigm!.duration).toBeTruthy();
  });

  it('an ally-only bonus puts no star on your sheet', () => {
    // Tweak Appearances gives the bonus to the person you are talking about, not to you.
    const ch = withSource('tweak-appearances');
    for (const skill of ['diplomacy', 'performance'] as const) {
      expect(statHasSituational(ch, { kind: 'skill', skill }, c())).toBe(false);
    }
  });
});

describe('G — which record carries the mark', () => {
  it('Distant Grasp marks the SPELL, since that is what you are looking at', () => {
    const marks = spellMarkersFor('dancing-blade', ['the-distant-grasp']);
    expect(marks).toHaveLength(1);
    expect(marks[0].bonus).toMatch(/\+2/);
  });

  it('the spell shows nothing to a character without the feature', () => {
    expect(spellMarkersFor('dancing-blade', [])).toEqual([]);
    expect(spellSituationalFor(build('fighter', 5), c(), 'dancing-blade')).toEqual([]);
  });

  it('every marked spell exists, and every source is a real record', () => {
    const bad: string[] = [];
    for (const [spellId, marks] of Object.entries(SPELL_MARKERS)) {
      if (!c().spells[spellId]) bad.push(`spell ${spellId} missing`);
      for (const m of marks) {
        const db = c() as unknown as Record<string, Record<string, unknown>>;
        const found = ['feats', 'items', 'classFeatures', 'heritages', 'backgrounds', 'ancestries'].some((k) => db[k]?.[m.source]);
        if (!found) bad.push(`source ${m.source} missing`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("a set's entry replaces the piece's, so you read one line not two", () => {
    // "Relic set: the set entry replaces the piece's, so you read one line, not two."
    const pairs = Object.entries(SITUATIONAL_SUPERSEDES);
    expect(pairs.length).toBeGreaterThan(0);
    for (const [setId, pieces] of pairs) {
      // With BOTH, the piece is dropped.
      expect([...supersededIds([setId, ...pieces])].sort()).toEqual([...pieces].sort());
      // With only the piece, it stands on its own.
      expect(supersededIds(pieces).size).toBe(0);
    }
  });

  it('the superseded piece really does drop out of a live star list', () => {
    const [setId, pieces] = Object.entries(SITUATIONAL_SUPERSEDES)[0];
    const both = { ...build('fighter', 5), feats: [setId, ...pieces].map((id) => ({ featId: id, level: 1, source: 'class' as const })) };
    // Whatever the piece alone would have said, it must not appear twice once the set is present.
    for (const ref of [{ kind: 'perception' as const }, { kind: 'ac' as const }]) {
      const lines = (explainStat(both, c(), ref).situational ?? []).map((s) => s.sourceId);
      for (const piece of pieces) expect(lines).not.toContain(piece);
    }
  });
});

describe('H — wording', () => {
  it('no note runs longer than about one line', () => {
    // "cap the note at about one line; anything longer gets trimmed to its essential trigger, with
    // the full text staying in the item's own description a click away."
    const long: string[] = [];
    for (const [id, list] of Object.entries(FEAT_SITUATIONAL)) {
      for (const b of list) if (b.when.length > 120) long.push(`${id} (${b.when.length})`);
    }
    expect(long).toEqual([]);
  });

  it('a note the sheet trimmed can be opened in full', () => {
    // The click target needs the record's id AND its collection to find the description again.
    const ch = { ...build('fighter', 5), inventory: [{ instanceId: 'i1', itemId: 'gaze-of-the-mantis', quantity: 1, invested: true }] };
    const notes = explainStat(ch, c(), { kind: 'perception' }).situational ?? [];
    const mine = notes.find((n) => /Gaze of the Mantis/.test(n.text));
    expect(mine?.sourceId).toBe('gaze-of-the-mantis');
    expect(mine?.sourceCollection).toBe('items');
  });

  it("Demon's Knot puts no star on the wearer's Will save", () => {
    // Owner overruled the suggestion to apply it to the wearer: "dosent effect the user".
    const ch = { ...build('fighter', 5), inventory: [{ instanceId: 'i1', itemId: 'demons-knot', quantity: 1, invested: true }] };
    const lines = (explainStat(ch, c(), { kind: 'save', save: 'will' }).situational ?? []).map((s) => s.text);
    expect(lines.some((l) => /-1 status.*Demon/.test(l))).toBe(false);
  });

  it('an open rule stays open — Bootstrap Respirator stars all saves', () => {
    // "keep it open. Star all saves, and the note says 'saves that require you to smell or taste.'"
    const ch = { ...build('fighter', 5), inventory: [{ instanceId: 'i1', itemId: 'bootstrap-respirator', quantity: 1, invested: true }] };
    for (const save of ['fortitude', 'reflex', 'will'] as const) {
      expect(statHasSituational(ch, { kind: 'save', save }, c()), `${save} should be starred`).toBe(true);
    }
  });
});

/**
 * batch-001, the MARKER half — and the three ways a mark lands on a row it does not belong to.
 *
 * `recordMarkersFor` is keyed by ACTION ID ALONE. It cannot know which skill's popup is asking, and
 * `StatDetailModal` draws the mark beside every skill whose SKILL_ACTIONS list carries that action.
 * So a mark is not "the row the feat modifies" — it is EVERY row that performs that action.
 */
describe('batch-001 — a mark lands on the row the player is actually looking at', () => {
  it('Ammunition Thaumaturgy marks Interact, not the commander tactic named "Reload!"', () => {
    // core.json's `reload` record is Battlecry!'s commander TACTIC — a mark filed there would render
    // on a commander's tactic row and never on a thaumaturge's. The feat's own text names Interact.
    const ch = withSource('ammunition-thaumaturgy');
    expect(recordMarkersFor(ch, c(), 'action', 'interact')).toHaveLength(1);
    expect(recordMarkersFor(ch, c(), 'action', 'reload')).toHaveLength(0);
    expect(c().actions['reload'].name).toBe('Reload!');
  });

  it('a mark on a SHARED action claims no number for the skill it does not touch', () => {
    /*
     * Escape is listed under Acrobatics AND Athletics; Subsist under Society AND Survival. Adrenaline
     * Rush's +1 status is Athletics-only and All of the Animal's clause is Survival-only, so neither
     * mark may carry a `value` — a bare "(+1 status)" beside the Acrobatics Escape row is a bonus the
     * feat does not grant, and the audit praises the record for NOT fanning out to Acrobatics.
     */
    const escape = RECORD_MARKERS['adrenaline-rush'].find((m) => m.id === 'escape')!;
    expect(escape.value).toBeUndefined();
    expect(escape.note).toMatch(/^Athletics only:/);
    // Force Open exists under Athletics ALONE, so there the number is safe to show.
    const forceOpen = RECORD_MARKERS['adrenaline-rush'].find((m) => m.id === 'force-open')!;
    expect(forceOpen.value).toBe('+1 status');

    const subsist = RECORD_MARKERS['all-of-the-animal'].find((m) => m.id === 'subsist')!;
    expect(subsist.value).toBeUndefined();
    expect(subsist.note).toMatch(/^Survival only:/);
  });

  it('Bargain Hunter\'s star and its mark lead to the same place', () => {
    /*
     * SKILL_ACTIONS ships Earn Income under Crafting, Lore and Performance only. Before this pass the
     * Diplomacy `*` opened a popup with no Earn Income line in it at all, while the mark rendered in
     * three popups belonging to skills the feat does not touch. The row below is the fix; its gate is
     * the FEAT'S NAME, because that is what StatDetailModal passes to `skillActionsFor`.
     */
    const has = (n: string) => n === 'Bargain Hunter';
    const withIt = skillActionsFor('diplomacy', 'trained', has).map((a) => a.name);
    const without = skillActionsFor('diplomacy', 'trained', () => false).map((a) => a.name);
    expect(withIt).toContain('Earn Income');
    expect(without).not.toContain('Earn Income');
    // …and the mark reaches that row.
    const marks = recordMarkersFor(withSource('bargain-hunter'), c(), 'action', 'earn-income');
    expect(marks.some((m) => m.sourceId === 'bargain-hunter')).toBe(true);
    // The gate is the NAME in core.json — a rename there silently empties the row.
    expect(c().feats['bargain-hunter'].name).toBe('Bargain Hunter');
  });

  it('two records with the same condition mark say which is which', () => {
    /*
     * The condition pill's hover concatenates notes; the precedent `steel-skin` is name-prefixed for
     * that reason, and a character can hold Steel Skin AND a regiment feat at once.
     */
    for (const id of ['armor-regiment-training', 'armored-regiment-training', 'steel-skin']) {
      const mark = RECORD_MARKERS[id].find((m) => m.on === 'condition' && m.id === 'fatigued')!;
      expect(mark, `${id} has no fatigued mark`).toBeDefined();
      expect(mark.note, `${id}'s note is not name-prefixed`).toMatch(/^[A-Z][A-Za-z' ]+:/);
    }
  });

  it('every batch-001 mark reaches a row the sheet actually draws', () => {
    /*
     * A record is not a ROW. `StatDetailModal` draws a mark only beside a `SKILL_ACTIONS` entry, and
     * `MainTab` only beside a curated ACTIVITY or a granted action — so a mark on an action that
     * exists in core.json but appears in neither list renders nowhere at all.
     */
    // Both surfaces slug the row's NAME to look the mark up (StatDetailModal's `actionSlug`,
    // MainTab's `actionId`), so the set of reachable ids is the set of slugged row names.
    const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const skillRows = new Set(Object.values(SKILL_ACTIONS).flat().map((a) => slug(a.name)));
    const activityRows = new Set(ACTIVITIES.map((a) => slug(a.name)));
    const BATCH = ['acrobatic-performer', 'adrenaline-rush', 'aeonbound', 'alchemical-assessment',
      'all-of-the-animal', 'ammunition-thaumaturgy', 'animal-soul-siblings', 'bamboo-and-silt-repose',
      'bargain-hunter', 'bodyguard'];
    const orphan: string[] = [];
    for (const id of BATCH) {
      for (const m of RECORD_MARKERS[id] ?? []) {
        if (m.on !== 'action') continue;
        if (skillRows.has(m.id) || activityRows.has(m.id)) continue;
        // `taunt` is a granted class action (classFeatures/taunt), which MainTab lists separately.
        if (Object.values(c().classFeatures).some((f) => (f as { grantsActions?: string[] }).grantsActions?.includes(m.id))) continue;
        orphan.push(`${id} → ${m.id}`);
      }
    }
    expect(orphan, 'these marks render on no row the sheet draws').toEqual([]);
    // …and the check can fail: an id that is a real core.json record but no ROW is unreachable.
    expect(c().actions['fling-magic'], 'fixture assumption').toBeDefined();
    expect(skillRows.has('fling-magic') || activityRows.has('fling-magic')).toBe(false);
  });
});

describe('the repaired descriptions', () => {
  const NAMELESS = /\b(?:Roll|roll|attempt|Attempt)\s+an?\s+checks?\b/;

  it('a record whose skill the rules DO name, names it', () => {
    // The importer stripped the label out of AoN's skill links, so 229 records read "Roll an check".
    // 139 were recoverable from the pristine mirror; these are a sample of them.
    const db = c() as unknown as Record<string, Record<string, { description?: string }>>;
    for (const [bucket, id] of [
      ['feats', 'explosive-death-drop'], ['feats', 'sacred-defense'], ['feats', 'log-roll'],
      ['feats', 'battle-prayer'], ['feats', 'freeze-it'], ['spells', 'web'], ['items', 'the-owl'],
    ] as const) {
      const d = String(db[bucket][id]?.description ?? '');
      expect(d, `${bucket}/${id} still has a nameless check`).not.toMatch(NAMELESS);
    }
  });

  it('a record whose skill the rules deliberately LEAVE open stays open', () => {
    // The repair must not invent a skill. Escape is rolled with your unarmed attack modifier OR
    // Acrobatics OR Athletics; Grease's first sentence names nothing on purpose. An earlier ordinal
    // version of the repair filled both in — that is the regression this guards.
    const db = c() as unknown as Record<string, Record<string, { description?: string }>>;
    expect(String(db.actions.escape?.description)).toMatch(/attempt a check using your unarmed attack modifier/i);
    expect(String(db.spells.grease?.description)).toMatch(/doesn't have to attempt a check or save/i);
  });

  it('every named check reads grammatically', () => {
    // "attempt a Acrobatics check" was the other half of that regression: the label was substituted
    // without fixing the article. The article agrees with the next WORD, so "a DC 15 Athletics" is
    // right and "a Athletics" is not.
    const db = c() as unknown as Record<string, Record<string, { description?: string }>>;
    const bad: string[] = [];
    for (const bucket of ['feats', 'items', 'spells', 'actions', 'classFeatures']) {
      for (const [id, rec] of Object.entries(db[bucket] ?? {})) {
        // A skill name only: Capitalised, immediately before "check". Without the capital this also
        // matched ordinary prose like "an hour and a successful check", where "an hour" is correct.
        for (const m of String(rec?.description ?? '').matchAll(/\b(a|an)\s+((?:DC \d+ )?[A-Z][A-Za-z']*(?: Lore)?)\s+checks?\b/g)) {
          const word = m[2].replace(/^DC \d+ /, m[2].startsWith('DC') ? 'DC' : '');
          const vowel = /^[AEIOU]/.test(word);
          if ((m[1] === 'a' && vowel) || (m[1] === 'an' && !vowel)) bad.push(`${bucket}/${id}: "${m[1]} ${m[2]}"`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
