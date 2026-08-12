import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { adjustModes, modeRelevant, playerModeLibrary, modeNumberBonus, hasConditionalMode, CATALOG_MODES } from '../src/rules/modes';
import { applyPlayState, emptyPlay } from '../src/rules/play';
import { ownedFeatureIds, resolveFormula } from '../src/rules/derive';
import type { ModeDef } from '../src/rules/types';

/**
 * AURA → MODE. Owner ruling Q29 (docs/gold-set-answers.md, Round 9): *"Aura should be a mode."*
 *
 * The lane's shape, and what each of these tests is really guarding:
 *   Q11 / Q1  an aura can be shut down and outlasts a round, so it is a mode rather than a passive.
 *   Ruling F  an ally's bonus lands on NO sheet of yours. The mode says the aura is running and
 *             carries the ally half as text; it never turns an ally's number into one of yours.
 *   Ruling M  no positional model — nothing is derived from who is standing inside the emanation.
 *   Principle B  the mode carries the full text even where nothing computes.
 *   Principle C  feats that REWRITE an aura attach to the aura's mode, which is why the mode has to
 *                exist at all. Champion's Aura is the case: eleven feats add to the same emanation.
 *   Gold answer #3  Shield the Faithful is the settled precedent for the numbers question — the mode
 *                carries real numbers for YOUR half (+1 item AC, resistance 10 spirit) and text for
 *                the ally half, and Healing Sanctuary rewrites its text without adding a number.
 */
const db = content();
const auraModes = () => Object.values(db.modes).filter((m) => m.category === 'Aura');
const modeOf = (id: string): ModeDef => {
  const m = db.modes[id];
  expect(m, `mode ${id} is missing`).toBeTruthy();
  return m;
};
const feats = (...ids: string[]) => ids.map((featId) => ({ featId }));

describe('the aura lane exists and every mode is reachable', () => {
  it('authored the aura records found, all gated to a real record', () => {
    const list = auraModes();
    expect(list.length).toBeGreaterThanOrEqual(38);
    for (const m of list) {
      expect(m.feats?.length, `${m.id} has no gate — nothing would ever show it`).toBeGreaterThan(0);
      for (const gate of m.feats!) {
        // The gate set the sheet builds is character.feats ∪ ownedFeatureIds, so a class-feature id
        // is legal — but an id in NEITHER bucket is a mode no character can ever see.
        expect(db.feats[gate] ?? db.classFeatures[gate], `${m.id}: gate "${gate}" is not a record`).toBeTruthy();
      }
    }
  });

  it('Principle B — every aura mode carries text, even the ones that compute nothing', () => {
    for (const m of auraModes()) expect(m.note, `${m.id} is an empty toggle`).toBeTruthy();
  });

  it('a mode gated to a feat is offered only to a character who has it', () => {
    const m = modeOf('aura-marshal-dedication');
    expect(modeRelevant(m, 'fighter', 'human', new Set())).toBe(false);
    expect(modeRelevant(m, 'fighter', 'human', new Set(['marshal-dedication']))).toBe(true);
  });
});

describe('gold answer #3 — Shield the Faithful, the precedent for the numbers', () => {
  const m = () => modeOf('aura-shield-the-faithful');

  it('carries REAL numbers for your half', () => {
    // "+1 item bonus to AC and resistance 10 to spirit damage" — unconditional while it runs, and
    // nothing else on the record carried them, so the mode moves the number rather than starring it.
    expect(modeNumberBonus([m()], { kind: 'ac' })).toBe(1);
    expect(m().resistances?.[0].type).toBe('spirit');
  });

  it('scales the spirit resistance the way the feat does, not by a remembered constant', () => {
    // "At 20th level, the spirit resistance increases to 15" — a formula, because a flat 10 would be
    // wrong for exactly the characters who can take a 14th-level feat and reach 20th.
    const f = String(m().resistances?.[0].value);
    expect(f).toMatch(/@actor\.level/);
    // Resolved through the ENGINE's own formula reader, not a private evaluator: a formula the
    // engine cannot parse silently resolves to 0, and a test with its own maths would not notice.
    const at = (level: number) => resolveFormula(f, { level });
    expect(at(14)).toBe(10);
    expect(at(19)).toBe(10);
    expect(at(20)).toBe(15);
  });

  it('keeps the ally half and the attacker damage as TEXT (Ruling F)', () => {
    expect(m().note).toMatch(/allies within 10 feet/i);
    expect(m().note).toMatch(/5 spirit damage/i);
    // The retaliation damage is dealt to the attacker; it must not become a modifier of yours.
    expect(m().modifiers.every((x) => x.target !== 'damage')).toBe(true);
  });

  it('Healing Sanctuary rewrites that mode and adds no number (Principle C + Q1)', () => {
    const adjusted = adjustModes([m()], feats('healing-sanctuary'), db);
    expect(adjusted[0].note).toMatch(/Healing Sanctuary/);
    expect(adjusted[0].note).toMatch(/temporary Hit Points/i);
    expect(adjusted[0].modifiers).toEqual(m().modifiers); // rounds are not tracked ⇒ no number
  });
});

describe("Principle C — the champion's aura is what eleven feats attach to", () => {
  const base = () => modeOf('aura-champions-aura');

  it('the anchor mode computes nothing by itself — it is a range and a switch', () => {
    expect(base().modifiers).toEqual([]);
    expect(base().note).toMatch(/15-foot emanation/);
  });

  it('each feat that adds to it is reflected IN it, not in a toggle of its own', () => {
    const withFeats = adjustModes(base() ? [base()] : [], feats('aura-of-life', 'aura-of-despair', 'oath-of-the-defender'), db);
    expect(withFeats[0].note).toMatch(/Aura of Life/);
    expect(withFeats[0].note).toMatch(/Aura of Despair/);
    expect(withFeats[0].note).toMatch(/Oath of the Defender/);
    // ...and none of them invented a second aura mode.
    expect(Object.values(db.modes).filter((x) => x.id.startsWith('aura-aura-of-life')).length).toBe(0);
  });

  it('a champion CLASS FEATURE can rewrite it too, not only a feat', () => {
    // The reader used to look in content.feats only, so a class-feature rewrite was written and
    // never read — the write-only trap this project keeps paying for. Blessed Swiftness is a
    // champion class feature at 3rd level, so it can only arrive through ownedFeatureIds.
    const adjusted = adjustModes([base()], [], db, new Set(['blessed-swiftness']));
    expect(adjusted[0].note).toMatch(/Blessed Swiftness/);
  });

  it('and the WIRING carries it — a real champion, through applyPlayState', () => {
    // adjustModes being right is not enough: play.ts is the only caller, and until this change it
    // passed no feature ids at all. Building an actual champion and overlaying real play state is
    // what proves the class-feature rewrite reaches the sheet rather than just the function.
    // Blessed Swiftness is a BLESSING the champion picks, not a leveled feature: it reaches the
    // sheet through extraChoices → classChoices → ownedFeatureIds, and a champion who chose a
    // different blessing must not get its line. Building it the way a player would is the point.
    const champ = build('champion', 14, { extraChoices: { blessing: ['blessed-swiftness'] } });
    expect([...ownedFeatureIds(champ, db)], 'the fixture must actually own the feature').toContain('blessed-swiftness');
    const live = applyPlayState(champ, { ...emptyPlay(), activeModes: ['aura-champions-aura'] }, db);
    const aura = live.activeModes?.find((m) => m.id === 'aura-champions-aura');
    expect(aura?.note).toMatch(/Blessed Swiftness/);

    // ...and a champion who chose a different blessing does NOT get that line.
    const other = build('champion', 14, { extraChoices: { blessing: ['blessed-armament'] } });
    const otherLive = applyPlayState(other, { ...emptyPlay(), activeModes: ['aura-champions-aura'] }, db);
    expect(otherLive.activeModes?.[0].note).not.toMatch(/Blessed Swiftness/);
  });

  it('every gate and every rewriter is REACHABLE by some legal build', () => {
    // The failure this guards is the one that keeps recurring: a record ownedFeatureIds cannot reach
    // is invisible, however correct its data. A class-feature gate or rewriter that no build owns
    // would be authored, tested against the function, and dead on the sheet.
    const reachable = new Set<string>([
      ...ownedFeatureIds(build('champion', 14, { extraChoices: { blessing: ['blessed-swiftness'] } }), db),
      ...ownedFeatureIds(build('commander', 5), db),
      ...ownedFeatureIds(build('kineticist', 9, { extraChoices: { element: ['air-gate', 'earth-gate', 'fire-gate', 'metal-gate', 'water-gate', 'wood-gate'] } }), db),
      ...ownedFeatureIds(build('thaumaturge', 17, { extraChoices: { implement: ['regalia', 'shield', 'lantern'] } }), db),
      ...ownedFeatureIds(build('thaumaturge', 17, { extraChoices: { implement: ['shield', 'regalia', 'lantern'] } }), db),
      ...ownedFeatureIds(build('exemplar', 5, { extraChoices: { ikon: ['fetching-bangles'] } }), db),
      ...ownedFeatureIds(build('exemplar', 5, { extraChoices: { ikon: ['mirrored-aegis'] } }), db),
      ...ownedFeatureIds(build('exemplar', 5, { extraChoices: { ikon: ['victors-wreath'] } }), db),
    ]);
    const unreachable = Object.values(db.modes)
      .filter((m) => m.category === 'Aura')
      .flatMap((m) => m.feats ?? [])
      .filter((id) => !db.feats[id] && !reachable.has(id)); // a FEAT gate is always reachable — the player picks it
    expect(unreachable, 'aura gates no character can own').toEqual([]);

    const rewriters = Object.entries(db.classFeatures)
      .filter(([, r]) => r.modeAdjust?.some((a) => a.match.ids?.some((x) => x.startsWith('aura-'))))
      .map(([id]) => id);
    expect(rewriters.length).toBeGreaterThan(0);
    expect(rewriters.filter((id) => !reachable.has(id)), 'class features whose aura rewrite nothing can own').toEqual([]);
  });

  it('Ruling F — no ally resistance leaks onto your sheet through the mode', () => {
    // Oath of the Defender says "allies ... NOT including you". If its resistance ever became a
    // mode resistance, the champion would silently gain a resistance the feat denies them.
    const adjusted = adjustModes([base()], feats('oath-of-the-defender'), db);
    expect(adjusted[0].resistances ?? []).toEqual([]);
  });
});

describe('the self half, and the rule that decides whether it is a real number', () => {
  it('a bonus restricted by circumstance is CONDITIONAL — it displays, it does not move the stat', () => {
    const marshal = modeOf('aura-marshal-dedication');
    expect(modeNumberBonus([marshal], { kind: 'save', detail: 'will' })).toBe(0);
    expect(hasConditionalMode([marshal], { kind: 'save', detail: 'will' })).toBe(true);
    expect(marshal.modifiers[0].appliesWhen).toMatch(/fear/i);
  });

  it('an unrestricted bonus IS a real number — Eternal Blessing is a standing bless', () => {
    expect(modeNumberBonus([modeOf('aura-eternal-blessing')], { kind: 'attack' })).toBe(1);
  });

  it('a resistance another lane already grants permanently is NOT repeated in the mode', () => {
    // Primal Aegis' six resistances are a permanent `resistances` field on the feat. Repeating them
    // here would list every one of them twice in the resistance breakdown.
    expect(db.feats['primal-aegis'].resistances?.length).toBe(6);
    expect(modeOf('aura-primal-aegis').resistances ?? []).toEqual([]);
  });

  it('the water gate junction DOES carry a resistance, because nothing else does', () => {
    // "creatures in the aura gain fire resistance equal to half your level" includes the kineticist.
    const r = modeOf('aura-water-gate-junction').resistances?.[0];
    expect(r?.type).toBe('fire');
    expect(String(r?.value)).toMatch(/@actor\.level/);
  });

  it("Commander Dedication's banner deliberately grants no Will bonus", () => {
    // The feat says so in as many words; a mode copied from the class feature would have been wrong.
    const m = modeOf('aura-commander-dedication');
    expect(m.modifiers).toEqual([]);
    expect(m.note).toMatch(/does NOT grant/i);
  });
});

describe('Ruling M — the mode says the aura is running; it models no positions', () => {
  it('no aura mode derives anything from who is standing in the emanation', () => {
    for (const m of auraModes()) {
      expect(m.battleForm, `${m.id} must not set a battle form`).toBeUndefined();
      // Speeds are the one grant an aura may carry, and only Convocation states one (the fly spell
      // it names). Anything else granting a Speed would be a positional inference.
      if (m.speeds) expect(m.id).toBe('aura-convocation-of-earth-and-moon');
    }
  });
});

describe('a content mode with a gate is content, not one of the player’s own modes', () => {
  it('the Modes panel would otherwise have offered every aura to every character', () => {
    // `playerModeLibrary` feeds the panel's "Your modes" section, which is NOT relevance-filtered
    // and offers Edit/Delete. Gated content modes belong in the gated section instead, or a level-1
    // fighter is shown the champion's aura, the lantern's aura and 36 more they cannot have.
    const lib = playerModeLibrary(Object.values(db.modes));
    expect(lib.filter((m) => m.category === 'Aura')).toEqual([]);
    expect(lib.some((m) => m.feats?.length || m.classes?.length || m.ancestries?.length)).toBe(false);
  });

  it('but a mode the PLAYER wrote still reaches their library', () => {
    const mine: ModeDef = { id: 'mode-abc', name: 'Mine', modifiers: [] };
    expect(playerModeLibrary([mine]).map((m) => m.id)).toEqual(['mode-abc']);
  });

  it('and the catalog is untouched — those are gated in the panel already', () => {
    expect(CATALOG_MODES.length).toBeGreaterThan(0);
    expect(playerModeLibrary(CATALOG_MODES)).toEqual([]);
  });
});
