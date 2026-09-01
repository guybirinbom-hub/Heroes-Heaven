/*
 * How to answer a BACKGROUND-granted feat's sub-choice when the background has already answered it.
 *
 * The sibling of `FEAT_GRANT_BOUND_CHOICE` in featFeatGrants.ts, for the other lane that hands a
 * character a feat they did not pick. The defect is identical and was found the same way: Abadar's
 * Avenger says *"You gain the Assurance skill feat with Religion"* and the builder still offered the
 * free 16-skill list, so a player could be assured in Stealth by a background that names Religion.
 *
 * Ruling Q20 is why this matters beyond tidiness. Assurance moves no number, so the ONLY thing the
 * answer does is decide which skill gets the `*` — the owner's *"remember Assurance needs to have a
 * `*` on the skill that it affects"*. A wrong answer therefore puts the star on the wrong row, and an
 * absent answer puts it nowhere at all, which is what an unanswered background grant did.
 *
 * Hand-authored rather than derived, for the same reason the feat table is: the binding is a reading
 * of each record's own sentence, and no field carries it. Deriving from `trainedSkill` would be wrong
 * four ways in this very set — Aeronaut trains Athletics and assures Piloting LORE, Conservator's
 * grant only exists on one branch of its skill pick, Raised by Belief's skill comes from the deity,
 * and Keys to Destiny's Assurance is genuinely free (it is deliberately absent below).
 *
 * ⚠ Every entry quotes the sentence it was read from. A binding with no quote is a guess, and a guess
 * here silently overrides a choice the player was entitled to make.
 */

/**
 * `fixed`       — the text names the skill outright ("with Religion").
 * `fixedLore`   — the text names a LORE ("with Piloting Lore"); `subject` is the bare subject.
 * `bgSkill`     — "your chosen skill": follows the background's own `trainedSkillChoice` pick, read
 *                 through the same defaulting `backgroundGrantedFeats` uses, so the assured skill and
 *                 the trained skill cannot disagree.
 * `bgLore`      — "the chosen lore": follows the background's free-text Lore. No default — an unnamed
 *                 Lore binds nothing rather than inventing a subject (as Gnome Obsession does).
 * `deitySkill`  — "the deity's listed Divine Skill": follows the chosen deity's `skill`.
 */
export type BackgroundBoundAnswer =
  | { kind: 'fixed'; skill: string }
  | { kind: 'fixedLore'; subject: string }
  | { kind: 'bgSkill' }
  | { kind: 'bgLore' }
  | { kind: 'deitySkill' };

export const BACKGROUND_GRANT_BOUND_CHOICE: Record<string, Record<string, BackgroundBoundAnswer>> = {
  // ---- Assurance, skill named outright -------------------------------------------------------
  // "You gain the Assurance skill feat with Religion."
  'abadars-avenger': { assurance: { kind: 'fixed', skill: 'religion' } },
  // "You gain the Assurance skill feat with Stealth."
  'mantis-scion': { assurance: { kind: 'fixed', skill: 'stealth' } },
  // "You gain the Assurance skill feat with Survival."
  'goblinblood-orphan': { assurance: { kind: 'fixed', skill: 'survival' } },
  // "You gain the Assurance skill feat with Athletics."
  'lumber-consortium-laborer': { assurance: { kind: 'fixed', skill: 'athletics' } },
  // "You gain the Assurance skill feat with Medicine."
  'eldritch-anatomist': { assurance: { kind: 'fixed', skill: 'medicine' } },
  // "You gain the Assurance skill feat with Athletics."
  farmhand: { assurance: { kind: 'fixed', skill: 'athletics' } },
  // "You gain the Assurance skill feat with Survival."
  nomad: { assurance: { kind: 'fixed', skill: 'survival' } },
  // "You gain the Assurance skill feat with Athletics."
  'star-athlete': { assurance: { kind: 'fixed', skill: 'athletics' } },
  // "If you chose Thievery, you gain the Assurance (Thievery) skill feat." The Crafting branch grants
  // Quick Repair instead, so wherever Assurance exists at all the skill is Thievery — `fixed`, not
  // `bgSkill`. (`grantedFeatByChoice` is what decides which branch is granted; this only answers it.)
  conservator: { assurance: { kind: 'fixed', skill: 'thievery' } },

  // ---- Assurance, bound to the background's own skill pick ------------------------------------
  // "You gain the Assurance skill feat with the skill you chose to become trained in (Medicine or Stealth)."
  'tapestry-refugee': { assurance: { kind: 'bgSkill' } },
  // "You're trained in your choice of the Deception or Society skills, and gain the Assurance skill
  //  feat with your chosen skill."
  'friend-of-greensteeples': { assurance: { kind: 'bgSkill' } },
  // "You are trained in your choice of the Athletics or Performance skill… You gain the Assurance
  //  skill feat in your chosen skill."
  'firebrand-follower': { assurance: { kind: 'bgSkill' } },
  // "You're trained in your choice of the Arcana, Nature, Occultism, or Religion skill, and gain the
  //  Assurance skill feat in your chosen skill."
  scholar: { assurance: { kind: 'bgSkill' } },
  // "You're trained in your choice of the Arcana, Nature, or Occultism skill, and gain the Assurance
  //  skill feat in your chosen skill."
  stargazer: { assurance: { kind: 'bgSkill' } },

  // ---- Assurance, bound to a Lore ------------------------------------------------------------
  // "You gain the Assurance skill feat with Piloting Lore." ⚠ NOT Athletics — that is the skill this
  // background trains, and reading the binding off `trainedSkill` would have got this one wrong.
  aeronaut: { assurance: { kind: 'fixedLore', subject: 'piloting' } },
  // "You're trained in the Acrobatics skill and either the Driving Lore or Piloting Lore skill. You
  //  gain the Assurance skill feat with the chosen lore."
  driver: { assurance: { kind: 'bgLore' } },

  // ---- Assurance, bound to the deity --------------------------------------------------------
  // "You're trained in the deity's listed Divine Skill and gain the Assurance feat with that skill."
  'raised-by-belief': { assurance: { kind: 'deitySkill' } },

  // ---- the other four feats whose option the text names --------------------------------------
  // "You gain the Terrain Stalker (underbrush) skill feat."
  'nirmathi-guerrilla': { 'terrain-stalker': { kind: 'fixed', skill: 'underbrush' } },
  // "You gain the Specialty Crafting skill feat with alchemy"
  'merabite-prodigy': { 'specialty-crafting': { kind: 'fixed', skill: 'alchemy' } },
  // "You gain the Specialty Crafting skill feat with the blacksmithing specialty."
  alloysmith: { 'specialty-crafting': { kind: 'fixed', skill: 'blacksmithing' } },
  // "You gain the Terrain Expertise skill feat with underground terrain."
  'sandswept-survivor': { 'terrain-expertise': { kind: 'fixed', skill: 'underground' } },
  // "You gain the Terrain Expertise skill feat for forests."
  dendrologist: { 'terrain-expertise': { kind: 'fixed', skill: 'forest' } },
  // "If you chose Survival, you gain the Terrain Expertise (Underground) skill feat."
  'dedicated-delver': { 'terrain-expertise': { kind: 'fixed', skill: 'underground' } },
  // "You gain the Terrain Expertise (forest) skill feat."
  'outskirt-dweller': { 'terrain-expertise': { kind: 'fixed', skill: 'forest' } },
  // "You gain the Terrain Expertise skill feat with underground terrain."
  miner: { 'terrain-expertise': { kind: 'fixed', skill: 'underground' } },
  // "You gain the Terrain Expertise skill feat with both swamp terrain and subterranean bodies of
  //  water." The second terrain is now a value the feat offers — `subterranean-water`, added because
  //  this sentence names a terrain the printed nine do not contain (Foundry has the same nine and
  //  drops the clause). The binding still names only `swamp`, because the grant is ONE take of the
  //  feat and a binding holds one answer.
  //  ⚠ STILL SHORT OF THE TEXT: two terrains means two takes, and neither `grantedFeatId` nor this
  //  table can express the same feat granted twice with different answers. A Witchlight Follower who
  //  wants the second one has to spend a skill feat on it and pick `subterranean-water` themselves.
  'witchlight-follower': { 'terrain-expertise': { kind: 'fixed', skill: 'swamp' } },
  // "You gain the Virtuosic Performer (Comedy) skill feat."
  clown: { 'virtuosic-performer': { kind: 'fixed', skill: 'comedy' } },
  // "choose either the Assurance skill feat with Society or the Multilingual skill feat" — the
  // Assurance branch names its skill outright; the Multilingual branch has no sub-answer to bind.
  // (batch 20 — the either/or is now a real two-way choice on the record.)
  'hermean-heritor': { assurance: { kind: 'fixed', skill: 'society' } },
  // The record's own PFS note: the Specialty Crafting granted by Weaver takes Weaving — the same
  // binding shape featFeatGrants' web-weaver already carries. Moved OFF the absent list (batch 20).
  weaver: { 'specialty-crafting': { kind: 'fixed', skill: 'weaving' } },
  // "You gain the Diehard feat and the Additional Lore feat for Boneyard Lore." The one background
  // whose Additional Lore names its subject — the seven others granting the feat leave the subject
  // to the player (their text box mounts through Builder's slotless-grant lane). Bound, the feat's
  // 3rd/7th/15th rankUpgrade advances Boneyard Lore, which `trainedLore` alone never did. (batch 23)
  returned: { 'additional-lore': { kind: 'fixedLore', subject: 'boneyard' } },

  /*
   * DELIBERATELY ABSENT — the text really does leave the pick to the player, so binding these would
   * take away a choice they are owed:
   *   keys-to-destiny  "You gain the Assurance skill feat and are trained in one of the following
   *                     Lore skills…" — the Lore is chosen; the Assurance is not tied to it.
   *   emancipated, hired-killer, spotter, student-of-archery, hell-hunted  (Terrain Stalker)
   *   local-scion, shory-seeker, framed-in-ferrous-quarter, brevic-noble, close-ties, artisan,
   *   artist, tinker, silk-farmer, professional-letter-writer, combat-carpenter
   *                                                                    (Specialty Crafting)
   *   trailblazer, surge-investigator, obari-wanderer                   (Terrain Expertise)
   *   musical-prodigy, saloon-entertainer                               (Virtuosic Performer)
   *   relentless-dedication                                             (Canny Acumen — and ruling
   *                     Q21 says its options must not be filtered either)
   *
   * NOT bindings, but NOT free either — three records narrow the list instead of naming one answer,
   * which is ruling Q9's filtering lane rather than this one, and is unbuilt:
   *   isgeri-reclaimer  "Terrain Stalker skill feat in either rubble or underbrush"  (2 of 3)
   *   toymaker          "choosing Artistry, Blacksmithing, Glassmaking, Leatherworking, Tailoring,
   *                      or Woodworking as your specialty"                            (6 of 12)
   *   reputation-seeker "underground if you have Darklands Lore, desert if you have Desert Lore, or
   *                      forest if you have Jungle Lore" — conditional on Lores held, not a filter.
   */
};

/**
 * Is this background-granted feat's sub-choice the BACKGROUND's to answer?
 *
 * Separate from resolving it, because a binding can be declared and not yet answerable — Driver's
 * Lore has no default until the player types a subject, and Raised by Belief's skill needs a deity.
 * The builder must withhold its free picker in BOTH states, or it offers a control whose answer is
 * discarded the moment the real one arrives.
 */
export function isBoundBackgroundGrant(backgroundId: string | undefined, grantedId: string): boolean {
  return !!(backgroundId && BACKGROUND_GRANT_BOUND_CHOICE[backgroundId]?.[grantedId]);
}

/*
 * A BACKGROUND that grants a player-CHOSEN innate cantrip — the background twin of
 * FEAT_CANTRIP_GRANTS (Dragon Spit's lane). The answer shares BuildState.pickCantripChoices, keyed by
 * the background id; buildCharacter injects it into the pooled innate entry, and the builder renders
 * the picker on the background card.
 *
 * Kept HERE rather than in featCantripGrants.ts because scripts/aon-verify/apply-clear.ts rewrites
 * that file whole through a serialiser — anything it does not emit is deleted at its next run.
 */
export const BACKGROUND_CANTRIP_GRANTS: Record<string, { prompt: string; tradition?: string; options: string[] }> = {
  /* *"You gain the ability to cast a common occult innate cantrip of your choice and can cast the
   * cantrip at will."* (batch 20). The list is the shipped common-occult-cantrip enumeration
   * Awakened Jewel already carries for the same printed criterion. */
  'harrow-chosen': { prompt: 'Choose a common occult cantrip', tradition: 'occult', options: ['approximate', 'bullhorn', 'daze', 'detect-magic', 'detect-metal', 'eat-fire', 'figment', 'forbidding-ward', 'glamorize', 'guidance', 'haunting-hymn', 'illuminate', 'infectious-enthusiasm', 'know-the-way', 'light', 'message', 'musical-accompaniment', 'needle-darts', 'phase-bolt', 'prestidigitation', 'protect-companion', 'read-aura', 'read-the-air', 'shield', 'sigil', 'summon-instrument', 'tame', 'telekinetic-hand', 'telekinetic-projectile', 'time-sense', 'tremor-signs', 'void-warp', 'warp-step', 'wash-your-luck'] },
};
