import { describe, it, expect } from 'vitest';
import { content } from './_content';

const db = content();

/**
 * Wanderer's-Guide parity batch 26 — the DATA half (heritage/action/feat records and three
 * description repairs). Every assertion pins an authored field against the printed sentence that
 * required it, quoted in the test name, so a regeneration that drops the overlay row fails here
 * rather than silently returning the record to its pre-batch shape.
 *
 * These read the SHIPPED content through `content()` (public/core.json merged with
 * public/core-descriptions.json, exactly as the app loads it). The rows are authored in
 * scripts/data/effect-backfill.json and only exist once `npm run data` has applied them, so this file
 * is red until the orchestrator applies work/.b026-rows.json — deliberately: an assertion written
 * against a locally patched copy would pass on a machine where the row never landed.
 *
 * Several findings additionally need an ENGINE half that is NOT in this file. Where that is so the
 * test pins the DATA and names the missing reader in a comment, so the pair cannot drift apart.
 */

/** Untyped view of a record, for fields whose lane interface does not declare them yet. */
const raw = (rec: unknown) => rec as unknown as Record<string, unknown>;

const her = (id: string) => db.heritages[id];

describe('batch 26 — ancestry Hit Points', () => {
  /* Four heritages print "You gain N Hit Points from your ancestry instead of M" and carried nothing,
   * so each built on its ancestry chassis and was short at every level. resolvedAncestryHp
   * (src/rules/build.ts:696) reads `heritage.ancestryHp` first; stoutheart-centaur is the precedent. */
  it('dragonscaled-kobold: "10 Hit Points from your ancestry instead of 6"', () => {
    expect(db.ancestries['kobold'].hp, 'the chassis the clause replaces').toBe(6);
    expect(her('dragonscaled-kobold').ancestryHp).toBe(10);
  });

  it('unbreakable-goblin: "10 Hit Points from your ancestry instead of 6"', () => {
    expect(db.ancestries['goblin'].hp).toBe(6);
    expect(her('unbreakable-goblin').ancestryHp).toBe(10);
  });

  it('great-kholo: "10 Hit Points from your ancestry instead of 8"', () => {
    expect(db.ancestries['kholo'].hp).toBe(8);
    expect(her('great-kholo').ancestryHp).toBe(10);
  });

  it('root-leshy: "10 Hit Points from your ancestry instead of 8"', () => {
    expect(db.ancestries['leshy'].hp).toBe(8);
    expect(her('root-leshy').ancestryHp).toBe(10);
  });

  it('mightyfall-kobold: the 10 HP is UNCONDITIONAL, not part of the attribute package', () => {
    /* Print gives the HP flat and the attribute swap as a separate "you can choose to", so a kobold
     * who keeps the normal boosts still gets 10. Both halves matter: leaving alternateAttributes.hp
     * beside an unconditional ancestryHp makes the decode at build.ts:8098 stamp every stored
     * character's answer as 'kaiju'. */
    const h = her('mightyfall-kobold');
    expect(h.ancestryHp).toBe(10);
    expect(h.alternateAttributes?.hp, 'must be gone, or the decode forces the kaiju answer').toBeUndefined();
    expect(h.alternateAttributes?.whenChoice, 'the attribute package itself survives').toBe('kaiju');
    expect(h.alternateAttributes?.abilityFlaws).toEqual(['int']);
    // …and the option label may no longer advertise the HP as a property of that branch.
    const kaiju = (h.choice?.options ?? []).find((o) => o.value === 'kaiju');
    expect(kaiju?.label).not.toMatch(/ancestry HP/i);
  });
});

describe('batch 26 — size, skills and languages', () => {
  it('ant-kholo: "Your size is Small instead of Medium"', () => {
    expect(db.ancestries['kholo'].size, 'the chassis the clause lowers').toBe('medium');
    // sizeSet is the only operator that may LOWER a size (build.ts:7818-7822).
    expect(her('ant-kholo').sizeSet).toBe('small');
  });

  it('ant-kholo: "trained in Deception (or another skill if you were already trained)"', () => {
    const ch = (her('ant-kholo').effectChoices ?? []).find((e) => e.id === 'trained-skill');
    expect(ch, 'the picker that carries both the grant and the printed redirect').toBeTruthy();
    const opts = ch!.options ?? [];
    // Deception is options[0] so the skill-only effectChoiceDefault hands out the printed skill
    // without the player having to answer.
    expect(opts[0].value).toBe('deception');
    expect(opts[0].grant?.skills?.deception).toBe('trained');
    expect(opts.length, 'one alternate per other skill').toBe(16);
    for (const o of opts.slice(1)) expect(Object.values(o.grant?.skills ?? {})[0], o.value).toBe('trained');
  });

  it('nomadic-halfling: "two additional languages… and another every time you take Multilingual"', () => {
    expect(her('nomadic-halfling').languageChoices).toBe(2);
    expect(her('nomadic-halfling').languageChoicesBonus).toEqual([{ featId: 'multilingual', extra: 1 }]);
    expect(db.feats['multilingual'], 'the named feat resolves').toBeTruthy();
  });

  it('ancient-ash: "At 5th level, you become an expert in that skill"', () => {
    /* DATA half. The reader (resolve the record's own effectChoices answer, then maxRank the step) is
     * engine agent 1's; `choiceId` points at the SAME pick print calls "that skill", never a second
     * free choice. */
    const prog = raw(her('ancient-ash')).skillProgressionFromChoice as { choiceId: string; at: { level: number; rank: string }[] };
    expect(prog).toEqual({ choiceId: 'skill', at: [{ level: 5, rank: 'expert' }] });
    expect((her('ancient-ash').effectChoices ?? []).some((e) => e.id === prog.choiceId), 'the named choice exists on the record').toBe(true);
  });
});

describe('batch 26 — grants that never reached the character', () => {
  it('bakuwa-lizardfolk: the bony plates are granted, and worn', () => {
    // "You can never wear other armor or remove your plates" — the hardshell-surki `worn` case.
    const g = her('bakuwa-lizardfolk').grantsItems ?? [];
    expect(g).toEqual([{ itemId: 'bakuwa-lizardfolk-bony-plates', quantity: 1, worn: true }]);
    const item = db.items['bakuwa-lizardfolk-bony-plates'];
    expect(item, 'the granted item resolves').toBeTruthy();
    expect(item.acBonus).toBe(4);
  });

  it('palace-echoes-kitsune: "You gain the Nudging Whisper action" — granted AND a real action cost', () => {
    // Both halves or nothing: MainTab's isActionCost filter drops a `passive` cost, so the grant
    // would render nothing on the sheet.
    expect(her('palace-echoes-kitsune').grantsActions).toEqual(['nudging-whisper']);
    expect(db.actions['nudging-whisper'].actionCost).toEqual({ type: 'actions', value: 1 });
  });

  it('venomtail-kobold: the granted Tail Toxin block prints "(manipulate)"', () => {
    expect(her('venomtail-kobold').grantsActions).toEqual(['tail-toxin']);
    expect(db.actions['tail-toxin'].traits).toContain('manipulate');
  });

  it('fungus-leshy: "You lose the plant trait and gain the fungus trait"', () => {
    const h = her('fungus-leshy');
    expect(h.grantsCreatureTraits).toEqual(['fungus']);
    /* The losing half. ancestries.leshy.traits is ['leshy','plant'] and creatureTraitsOf is add-only,
     * so shipping the fungus grant alone makes the Details tab read "leshy, plant, fungus" — which
     * print flatly denies. The subtractive pass is engine agent 2's; the field is authored now and is
     * inert until it lands. */
    expect(db.ancestries['leshy'].traits).toContain('plant');
    expect(raw(h).removesCreatureTraits).toEqual(['plant']);
  });

  it('jinxed-halfling: "You can never take the Halfling Luck feat"', () => {
    // DATA half. The eligibility filter that greys the feat out in the picker is engine agent 1's.
    expect(raw(her('jinxed-halfling')).forbidsFeats).toEqual(['halfling-luck']);
    expect(db.feats['halfling-luck'], 'the forbidden feat resolves').toBeTruthy();
  });
});

describe('batch 26 — choices print offers and we did not', () => {
  it('kijimuna-gnome: the two printed benefits are BRANCHES, not both', () => {
    const h = her('kijimuna-gnome');
    // "You gain your choice of the following benefits. Once made, this choice can't be changed."
    expect(h.grantsFeats, 'the unconditional grant is gone — it belongs to one branch').toBeUndefined();
    const ch = (h.effectChoices ?? []).find((e) => e.id === 'benefit');
    expect(ch).toBeTruthy();
    const opts = ch!.options ?? [];
    expect(opts.map((o) => o.value)).toEqual(['banyan', 'fish']);
    expect(opts[0].grant?.grantsFeats).toEqual(['combat-climber']);
    expect(db.feats['combat-climber'], 'the branch feat resolves').toBeTruthy();
    expect(opts[1].grant?.speeds).toEqual({ swim: 15 });
    /* degreeShifts is left untouched on purpose: gating the climb success-to-crit to the banyan
     * branch needs a new answer gate on DegreeShift and is engine agent 2's half. */
    expect(h.degreeShifts?.[0]?.shift).toBe('successToCrit');
  });

  it('wellspring-gnome: "Choose arcane, divine, or occult… as a spell of your chosen tradition"', () => {
    const h = her('wellspring-gnome');
    expect(h.choice?.flag).toBe('wellspringTradition');
    expect((h.choice?.options ?? []).map((o) => o.value)).toEqual(['arcane', 'divine', 'occult']);
    // Without the flag on the filter, three traditions survive narrowing and spellChoice.ts:54 leaves
    // the innate spell tagged with the SPELL's own first tradition instead of the player's answer.
    const f = (h.effectChoices ?? []).find((e) => e.id === 'wellspring-cantrip')?.spellFilter;
    expect(f?.traditionFromChoiceFlag).toBe('wellspringTradition');
    expect(f?.cantripsOnly).toBe(true);
  });

  it('wellspring-gnome: every primal gnome ancestry-feat spell retunes to the chosen tradition', () => {
    /* "Whenever you gain a primal innate spell from a gnome ancestry feat, change its tradition from
     * primal to your chosen tradition." Enumerated over core.json: these five are every gnome ancestry
     * feat with a primal innateSpells row. The reader (traditionFromFlag, build.ts:7012) currently
     * loops FEATS only, so a heritage-asked flag resolves to undefined and the rows are inert —
     * inert, never wrong: with no answer the tradition stays primal, exactly as today. */
    const ids = ['first-world-adept', 'homeward-bound', 'scarlet-strands', 'arboreal-conversationalist', 'kijimuna-whistle'];
    for (const id of ids) {
      const rows = db.feats[id].innateSpells ?? [];
      expect(rows.length, id).toBeGreaterThan(0);
      for (const r of rows.filter((x) => x.tradition === 'primal')) {
        expect(r.traditionFromChoiceFlag, `${id}/${r.spellId}`).toBe('wellspringTradition');
      }
    }
    // …and no OTHER gnome ancestry feat quietly gained a primal row while nobody was looking.
    const missed = Object.entries(db.feats)
      .filter(([, f]) => (f.traits ?? []).includes('gnome') && (f.innateSpells ?? []).some((s) => s.tradition === 'primal' && !s.traditionFromChoiceFlag))
      .map(([id]) => id);
    expect(missed, 'a new gnome feat with a primal innate spell needs the same flag').toEqual([]);
  });

  it('frozen-wind-kitsune: "your foxfire deals cold damage instead of electricity or fire"', () => {
    const lim = (her('frozen-wind-kitsune').choiceOptionLimits ?? [])[0];
    expect(lim?.target).toBe('foxfire');
    expect(lim?.flag).toBe('damage');
    expect(lim?.allow).toEqual([{ value: 'cold' }]);
    expect(lim?.reason, 'Q27: a narrowed menu that says nothing reads as missing content').toBeTruthy();
    /* `allow` is a WHITELIST over what the target already offers, so 'cold' must stay in foxfire's own
     * option list. Stopping a NON-frozen-wind kitsune from being offered it is engine agent 1's half. */
    expect((db.feats['foxfire'].choice?.options ?? []).map((o) => o.value)).toContain('cold');
  });
});

describe('batch 26 — riders that said more than print', () => {
  it('warrior-jotunborn: print waives a PENALTY; the fist keeps the nonlethal trait', () => {
    /* "The damage die for your fist increases to 1d6. You don't take a penalty when making a lethal
     * attack with your fist." No trait removal anywhere — and WG's own Warrior Jotunborn Fist item
     * retains Nonlethal. The waiver itself is carried as a situational star (the stars agent's half). */
    const r = (her('warrior-jotunborn').unarmedTraits ?? [])[0];
    expect(r?.match).toEqual(['fist']);
    expect(r?.setDie).toBe('d6');
    expect(r?.remove, 'stripping nonlethal is wider than print').toBeUndefined();
  });

  it('caveclimber-kobold: the hands-free clause is stated once, not twice', () => {
    /* Two carriers both landed on the Climb action row and markersFor merges them under one source
     * name, so the Climb row printed the hands-free rule twice. Print makes it a SEPARATE sentence
     * from the crit upgrade, so the parenthetical also mis-conditioned it on the check succeeding. */
    const d = (her('caveclimber-kobold').degreeShifts ?? [])[0];
    expect(d?.when).toBe('on the Athletics check to Climb');
    expect(d?.when).not.toMatch(/hands/i);
  });

  it('seaweed-leshy: "your land Speed is reduced by 5 feet (to 20 feet for most seaweed leshies)"', () => {
    const h = her('seaweed-leshy');
    expect(h.landSpeedBonus).toBe(-5);
    expect(db.ancestries['leshy'].speeds?.land, 'the chassis the penalty applies to').toBe(25);
    // The old `land: 0` was a no-statement placeholder derive.ts:4726 discards (`v > 0`), so it read
    // as if the penalty were modelled when nothing was.
    expect(h.speeds).toEqual({ swim: 20 });
    expect(h.breathesWater).toBe(true);
  });

  it('makari-lizardfolk: the granted cantrip loses manipulate, and lizardfolk spells turn divine', () => {
    const notes = her('makari-lizardfolk').spellNotes ?? [];
    for (const sid of ['divine-lance', 'forbidding-ward']) {
      const n = notes.find((x) => x.spellId === sid);
      expect(n, sid).toBeTruthy();
      // "When you cast this cantrip, it loses the manipulate trait, as you cast purely by roaring…"
      expect(n!.note).toMatch(/manipulate/);
      expect(db.spells[sid], 'the annotated spell resolves').toBeTruthy();
    }
    /* "The tradition of any spells or magical abilities you gain from a lizardfolk heritage or
     * ancestry feat is divine instead of its normal tradition." The open-set note lane; the
     * fromAncestrySpells scan at build.ts:6003 walks FEATS only today, so the heritage's row is inert
     * until engine agent 1 widens it. */
    const blanket = notes.find((n) => n.fromAncestrySpells);
    expect(blanket, 'the blanket tradition swap').toBeTruthy();
    expect(blanket!.note).toMatch(/divine/);
  });

  it('jotunborn skill heritages no longer tell the player to apply it by hand', () => {
    /* The dataWarning was a stale apply-patches rejection ("id not in feats/classFeatures") whose
     * reason no longer holds — heritage ids reach the proficiency pass at build.ts:4950. The
     * FEAT_GRANTS rows that actually deliver Society/Crafting/Survival are engine agent 1's. */
    for (const id of ['sage-jotunborn', 'weaver-jotunborn', 'keeper-jotunborn']) {
      expect(raw(her(id)).dataWarning, id).toBeUndefined();
    }
  });
});

describe('batch 26 — description repairs (numbers and names the importer deleted)', () => {
  it('charhide-goblin: "which is reduced to DC 5 if another creature… uses an action to help"', () => {
    const d = her('charhide-goblin').description ?? '';
    expect(d).toContain('reduced to DC 5 if another creature');
    expect(d, 'the dangling "reduced to if" is gone').not.toMatch(/reduced to if/);
  });

  it('wicked-thorns: "You deal 1d8 piercing damage to the triggering creature"', () => {
    // Thorned Rose's entire mechanical content is this action, and the die had been deleted.
    const d = db.actions['wicked-thorns'].description ?? '';
    expect(d).toContain('You deal 1d8 piercing damage to the triggering creature');
    // Print's own second mention says piercing, not bleed; mirror print rather than reconciling it.
    expect(d).toContain('the persistent piercing damage increases by 1');
  });

  it('nudging-whisper: both shipped copies name the Confabulator feat', () => {
    /* The repair script fixed only the actions copy, so the dead classFeatures twin still read "the
     * effects of the feat". The twin cannot be deleted through the overlay (apply-backfill has no
     * record-delete arm) — if it is ever removed for real, drop this assertion with it. */
    for (const rec of [db.actions['nudging-whisper'], db.classFeatures['nudging-whisper']]) {
      if (!rec) continue;
      expect(rec.description ?? '').toContain('the effects of the Confabulator feat');
    }
  });
});
