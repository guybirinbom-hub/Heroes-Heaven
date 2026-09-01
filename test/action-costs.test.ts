import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { isActionCost } from '../src/sheet/widgets';

/**
 * Feats that ARE actions must say so, or a player never finds them.
 *
 * The encounter action list is built from records whose own `actionCost` is 1–3 actions, a reaction
 * or a free action. 58 feats that are actions were stored as `passive` — Endure Death's Touch is a
 * Reaction, Educated Assessment a Single Action, Banishing Blow a Free Action — so they existed on
 * the sheet and nowhere a player would look for something to do on their turn.
 */
const c = () => content();

describe('feat action costs', () => {
  it.each([
    ['endure-deaths-touch', 'reaction'],
    ['reflexive-catch', 'reaction'],
    ['banishing-blow', 'free'],
    ['educated-assessment', 1],
    ['blood-frenzy', 1],
    ['merciless-rend', 1],
    /*
     * Mercy and Cruelty are PASSIVE, and were listed here as single actions because their LEGACY
     * printings were single-action metamagics. Both Remaster texts read *"You can cast <spell> …
     * using 2 actions instead of 1"* — the extra action is spent on the spell, and the feat itself
     * costs nothing. AoN agrees: their page titles carry a bare action node while a genuine action
     * (Educated Assessment, above) carries `string: "Single Action"`.
     */
    ['mercy', 'passive'],
    ['cruelty', 'passive'],
    /* Found by scripts/actioncost-vs-aon.mjs: stored passive, AoN states a cost, body text confirms.
     * A passive record never reaches the encounter action list, so these were unfindable on a turn. */
    ['dazzling-block', 'free'],
    ['heightened-captivation', 1],
    ['decree-of-banishment', 1],
  ])('%s costs %s', (id, cost) => {
    const a = c().feats[id as string]?.actionCost;
    expect(a, id as string).toBeTruthy();
    expect(a!.type === 'actions' ? a!.value : a!.type).toBe(cost);
  });

  /*
   * THE 99 RECORDS AoN'S BADGE COULD NOT SETTLE, adjudicated from the printed text and pinned here.
   *
   * `scripts/actioncost-vs-aon.mjs` only reports "we say none, AoN says action", because a BLANK
   * action badge is not AoN saying "no cost" — it is equally a scrape that lost the glyph. That left
   * 99 records carrying a cost nothing could confirm. All 99 were read: 65 kept, 31 changed, 3
   * proposed changes refuted. 29 of the 31 were then confirmed against Foundry's independent data.
   *
   * THE DOMINANT DEFECT, 27 of 31: a feat that GRANTS something, or MODIFIES another action, stored
   * THAT thing's cost as its own — so a passive feat sat in the encounter action list wearing a
   * number that belonged elsewhere. *"You can spend 2 actions to Direct your Follower instead of 1"*
   * is Direct your Follower's 2. Heart of the Kaiju's stored `1` was the kaiju form's own jaws glyph.
   *
   * Pinned in full rather than sampled: these were wrong for a systematic reason, and a regeneration
   * that re-derives any of them from the same damaged source would put the same number back.
   */
  it.each([
    // grants or modifies another action — the record itself costs nothing
    ['heart-of-the-kaiju', 'passive'], ['spellshot-dedication', 'passive'],
    ['shape-of-the-cloud-dragon', 'passive'], ['expand-spiral', 'passive'],
    ['worm-caller-dedication', 'passive'], ['companions-cry', 'passive'],
    ['buzzing-death-cicadas', 'passive'], ['instinctive-strike', 'passive'],
    ['dual-weapon-reload', 'passive'], ['chemical-contagion', 'passive'],
    ['improvised-pummel', 'passive'], ['morphic-strike', 'passive'],
    ['archfiend-dedication', 'passive'], ['manipulate-realm', 'passive'],
    ['assume-godhood', 'passive'], ['pact-of-the-fey-paths', 'passive'],
    ['venture-gossip-dedication', 'passive'], ['tactical-guidance', 'passive'],
    ['i-am-the-weapon', 'passive'], ['thaumaturges-demesne', 'passive'],
    ['talons-mark', 'passive'], ['aristocratic-arms', 'passive'],
    ['avenger-of-lust', 'passive'], ['avenger-of-wrath', 'passive'],
    // the six alchemist ADDITIVES: free actions in the legacy printing, applied as part of Quick
    // Alchemy in the Remaster with no action of their own
    ['smoke-bomb', 'passive'], ['healing-bomb', 'passive'], ['combine-elixirs', 'passive'],
    ['debilitating-bomb', 'passive'], ['sticky-bomb', 'passive'], ['exploitive-bomb', 'passive'],
    // the one whose own text names a cost: "Once per day AS A SINGLE ACTION, you can fly at
    // incredible speeds". Stored 2 matched nothing printed.
    ['ascend', 1],
  ])('%s costs %s (adjudicated from printed text)', (id, cost) => {
    const a = c().feats[id as string]?.actionCost;
    expect(a, id as string).toBeTruthy();
    expect(a!.type === 'actions' ? a!.value : a!.type).toBe(cost);
  });

  describe('a feat never wears the cost of an activity it merely grants', () => {
    /*
     * AoN states a page's own cost in its `<title>` glyph, and an EMPTY `<actions string="" />` there
     * means passive. Some pages then describe a GRANTED activity inline with its own glyph on a named
     * line — `**Activate—Host of Wrath** <actions string="Two Actions" />` — and the extractor used to
     * copy that onto the feat.
     *
     * The six mythic Avenger feats (Revenge of the Runelords, Feat 14) are the proof: five stored Two
     * Actions and Avenger of Lust stored a REACTION, each exactly matching its OWN nested activity,
     * while all six bodies are pure grant language. Fixed at the extractor (`grantedCost` in
     * scripts/lib/aon-facets.mjs now ignores named Activate lines) and guarded by
     * scripts/nested-activate-check.mjs; pinned here because a value is what a player actually gets.
     */
    it.each([
      'avenger-of-envy', 'avenger-of-gluttony', 'avenger-of-greed',
      'avenger-of-lust', 'avenger-of-sloth', 'avenger-of-wrath',
      // the same defect outside that family
      'spirit-warrior-dedication', 'starlit-sentinel-dedication',
    ])('%s is passive', (id) => {
      expect(c().feats[id].actionCost).toEqual({ type: 'passive' });
    });

    it('and still hands the player the activity it grants', () => {
      /* Passive without the grant is worse than the bug: the feat leaves the action list AND the
       * ability it gives you is nowhere. Each granted id must resolve to a record that holds the
       * cost — `avenger-of-wrath` printed two grants and recorded only one. */
      const grants: [string, string][] = [
        ['avenger-of-envy', 'aegis-of-envy'],
        ['avenger-of-gluttony', 'gluttonous-feast'],
        ['avenger-of-greed', 'convocation-of-greed'],
        ['avenger-of-lust', 'sorshens-devotion'],
        ['avenger-of-sloth', 'summon-sloth'],
        ['avenger-of-wrath', 'host-of-wrath'],
        ['spirit-warrior-dedication', 'overwhelming-combination'],
        ['starlit-sentinel-dedication', 'starlit-transformation'],
      ];
      for (const [feat, activity] of grants) {
        expect(c().feats[feat].grantsActions ?? [], feat).toContain(activity);
        expect(c().actions[activity], activity).toBeTruthy();
        expect(c().actions[activity].actionCost, activity).toBeTruthy();
      }
      /* Avenger of Wrath prints TWO grants — *"You gain the Reactive Strike reaction… You gain the
       * Host of Wrath activity"* — and only Reactive Strike was recorded. */
      expect(c().feats['avenger-of-wrath'].grantsActions).toContain('reactive-strike');
    });

    it("Sorshen's Devotion is a reaction, as its own glyph prints", () => {
      /* Found while checking the grants: the ACTION record carried 2 actions while AoN's nested glyph
       * for it reads `<actions string="Reaction" />` — the feat's wrong cost and the activity's wrong
       * cost were separate defects that happened to point at each other. */
      expect(c().actions['sorshens-devotion'].actionCost).toEqual({ type: 'reaction' });
    });
  });

  it('Mega Bomb is a 2-action activity — OWNER RULING', () => {
    /*
     * The one record of the 99 the printed text does not settle alone, ruled by the owner
     * (2026-08-20): *"it needs to be in the actions as a 2 action"*.
     *
     * Our stored `1` matched nothing. Wanderer's Guide encodes NO cost — `ability_block.actions` is
     * NULL for Mega Bomb and all six additive siblings, while Quick Bomber in the same family reads
     * ONE-ACTION, so the null is a statement (6,709 of their 10,843 feat rows are null); Foundry and
     * the six siblings agree. But the book prints exactly one number — *"Throwing this bomb takes a
     * 2-action activity instead of a Strike"* — and a passive feat never reaches the encounter action
     * list, which would leave the only thing a player DOES with this feat nowhere on their turn.
     *
     * ⚠ Does NOT generalise: the six siblings print no activity cost of their own and stay passive.
     * Mega Bomb is the only additive that replaces the Strike with a timed activity.
     */
    expect(c().feats['mega-bomb'].actionCost).toEqual({ type: 'actions', value: 2 });
    expect(isActionCost(c().feats['mega-bomb'].actionCost), 'must reach the action list').toBe(true);
    for (const id of ['smoke-bomb', 'sticky-bomb', 'debilitating-bomb', 'healing-bomb', 'exploitive-bomb', 'combine-elixirs']) {
      expect(isActionCost(c().feats[id].actionCost), `${id} stays out of the action list`).toBe(false);
    }
  });

  it('a feat keeps a cost when it grants an activity we do NOT ship separately', () => {
    /*
     * The mirror image, and the reason "grants something -> passive" is not a blanket rule: Tengu
     * Feather Fan grants the Activate—Wave Fan activation (`<actions string="Single Action" />`),
     * which we do NOT ship as its own record, so the cost on the feat is a player's only route to it.
     *
     * Soothing Pulse USED to sit beside it — but actions/administer-ambient-magic ships now, carries
     * the printed 2-action cost itself, and the feat grants it (grantsActions), so the only-route
     * argument lapsed and the feat went passive with the rest of the ostilli family (the
     * nested-activate sweep). A feat is passive exactly when the granted activity ships separately.
     */
    expect(c().feats['soothing-pulse'].actionCost).toEqual({ type: 'passive' });
    expect(c().feats['soothing-pulse'].grantsActions).toContain('administer-ambient-magic');
    expect(c().actions['administer-ambient-magic'].actionCost).toEqual({ type: 'actions', value: 2 });
    expect(c().feats['tengu-feather-fan'].actionCost).toEqual({ type: 'actions', value: 1 });
  });

  it('the corrected counts match their remaster printing', () => {
    // Forestall Curse became a Free Action in the Remaster and was still a Single Action here.
    expect(c().feats['forestall-curse'].actionCost).toEqual({ type: 'free' });
    expect(c().feats['dominion-aura'].actionCost).toEqual({ type: 'actions', value: 1 });
    expect(c().feats['whirlwind-toss'].actionCost).toEqual({ type: 'actions', value: 2 });
    expect(c().feats['throw-and-catch'].actionCost).toEqual({ type: 'actions', value: 2 });
  });

  it('each corrected feat now qualifies for the encounter action list', () => {
    // isActionCost is the gate MainTab uses; a passive record never passes it.
    for (const id of ['endure-deaths-touch', 'banishing-blow', 'educated-assessment', 'forestall-curse']) {
      expect(isActionCost(c().feats[id].actionCost), id).toBe(true);
    }
  });
});

describe('spell areas', () => {
  it('follow the remaster printing where the two editions differ', () => {
    // Door to Beyond was a 20-foot emanation in Gods & Magic and is a 20-foot burst in Divine
    // Mysteries; Distortion Lens went from "one 5-foot square" to a 5-foot burst.
    expect(c().spells['door-to-beyond'].baseArea).toEqual({ value: 20, kind: 'burst' });
    expect(c().spells['distortion-lens'].baseArea).toEqual({ value: 5, kind: 'burst' });
    expect(c().spells['rainbows-end'].baseArea).toEqual({ value: 10, kind: 'emanation' });
    // …and the display string agrees with the structured value.
    for (const id of ['door-to-beyond', 'distortion-lens', 'rainbows-end']) {
      const s = c().spells[id];
      expect(s.area, id).toBe(`${s.baseArea!.value}-foot ${s.baseArea!.kind}`);
    }
  });
});
