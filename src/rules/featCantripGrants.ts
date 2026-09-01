/*
 * Feats that grant a player-CHOSEN innate spell/cantrip from a fixed list (Dragon Spit, Arcane Tattoos,
 * Hag Magic, Celestial/Fiendish/Methodical Magic, Merge with the Source, Parallel Breakthrough).
 * Auto-extracted from Foundry ChoiceSet(itemType:spell, slugsAsValues) filters; options are limited to
 * spells HH ships (a few legacy slugs dropped). The pick lives in BuildState.pickCantripChoices and is
 * injected into the character's innate-spell entry by buildCharacter (cantrips at-will, higher 1/day at
 * the spell's base rank — exact feat heightening is not modeled). The Spells tab already renders it.
 */
export interface CantripPickSpec {
  /** Picker label. */
  prompt: string;
  /**
   * The TRADITION the feat grants the picked spell at — "you can cast this spell as an primal innate
   * spell", "you gain one cantrip from the occult spell list".
   *
   * Without it `buildCharacter` pushed the pick as a bare `{ spellId }` and the pooled innate entry
   * fell back to the SPELL's first tradition, so a sarangay's occult Bullhorn made the character an
   * ARCANE caster — a tradition Awakened Jewel never allows. Confirmed by building the characters, not
   * inferred.
   *
   * ⚠ `scripts/aon-verify/apply-clear.ts` REWRITES this file whole through a serialiser; anything it
   * does not emit is deleted at that script's next run. Add a field here and add it there too.
   */
  tradition?: string;
  /** …or the tradition is the PLAYER's answer, named by the flag of the choice that asked — Bone
   *  Magic's *"Choose when you gain this feat whether your innate spells are primal or occult"*. Same
   *  field name and meaning as `InnateSpellGrant.traditionFromChoiceFlag`. */
  traditionFromChoiceFlag?: string;
  /**
   * …or the tradition is stated PER OPTION, in the same sentence as the option. Two records do this
   * and both had been written off as naming no tradition: Speaker in Training — *"If you're a
   * Faithspeaker, you can cast Bless once per day as a divine innate spell; if you're a Greenspeaker,
   * you can cast Fleet Step once per day as a primal innate spell"* — and Merge with the Source, whose
   * four fiend/celestial forms are cast "as a divine spell" and whose elemental and plant forms are
   * cast "as a primal spell".
   *
   * Keyed by the option's spell id. An id absent from the map falls back to `tradition`.
   */
  traditionByOption?: Record<string, string>;
  /** Spell ids the player may choose from. */
  options: string[];
}

export const FEAT_CANTRIP_GRANTS: Record<string, CantripPickSpec> = {
  'advanced-runelord-magic': { prompt: "Choose a spell", tradition: 'arcane', options: ['darkvision', 'mystic-armor', 'runic-body', 'runic-weapon', 'see-the-unseen', 'sending', 'truesight', 'contingency', 'spell-riposte', 'foresight', 'unrelenting-observation'] },
  'anarchic-arcana': { prompt: "Choose a spell from today's d12 rolls", tradition: 'divine', options: ['acid-grip', 'blur', 'gecko-grip', 'humanoid-form', 'illusory-object', 'laughing-fit', 'noise-blast', 'resist-energy', 'see-the-unseen', 'shatter', 'shrink', 'telekinetic-maneuver'] },
  'ancestral-healer': { prompt: "Choose a spell", tradition: 'occult', options: ['clear-mind', 'sound-body'] },
  /* *"ONCE PER DAY, you can cast EITHER create water OR hydraulic push as a 1st-rank primal innate
   * spell."* One casting of one spell — and the record used to carry BOTH as `innateSpells` at 1/day
   * each, so the character got two daily castings instead of one. This is the pick lane: one answer,
   * one grant, one use. */
  'apprentice-sea-witch': { prompt: "Choose create water or hydraulic push (1st-rank primal innate, 1/day)", tradition: 'primal', options: ['create-water', 'hydraulic-push'] },
  'arcane-tattoos': { prompt: "Choose a cantrip", tradition: 'arcane', options: ['shield', 'tangle-vine', 'daze', 'electric-arc', 'figment', 'void-warp', 'sigil'] },
  'awakened-jewel': { prompt: "Choose an occult cantrip", tradition: 'occult', options: ['approximate', 'bullhorn', 'daze', 'detect-magic', 'detect-metal', 'eat-fire', 'figment', 'forbidding-ward', 'glamorize', 'guidance', 'haunting-hymn', 'illuminate', 'infectious-enthusiasm', 'know-the-way', 'light', 'message', 'musical-accompaniment', 'needle-darts', 'phase-bolt', 'prestidigitation', 'protect-companion', 'read-aura', 'read-the-air', 'shield', 'sigil', 'summon-instrument', 'tame', 'telekinetic-hand', 'telekinetic-projectile', 'time-sense', 'tremor-signs', 'void-warp', 'warp-step', 'wash-your-luck'] },
  'awakened-magic': { prompt: "Choose a primal cantrip", tradition: 'primal', options: ['approximate', 'caustic-blast', 'deep-breath', 'detect-magic', 'detect-metal', 'draw-moisture', 'eat-fire', 'electric-arc', 'frostbite', 'gale-blast', 'glamorize', 'glass-shield', 'gouging-claw', 'guidance', 'healing-plaster', 'ignition', 'illuminate', 'know-the-way', 'light', 'live-wire', 'needle-darts', 'prestidigitation', 'protect-companion', 'puff-of-poison', 'read-aura', 'root-reading', 'rousing-splash', 'scatter-scree', 'sigil', 'slashing-gust', 'spout', 'stabilize', 'take-root', 'tame', 'tangle-vine', 'timber', 'tremor-signs', 'vitality-lash'] },
  /* 'basic-skysage-divination' — REMOVED. This lane injects the pick into the character's INNATE
   * entry (see the header), and the printed text puts the spell in the REPERTOIRE: *"choose one of the
   * following 1st-rank spells to your spell repertoire … You can Cast this Spell as an occult Oatia
   * skysage spell."* The Oatia archetype is already `repertoire: true` with rank 1/2/3 unlocks at
   * levels 4/6/8 (casterArchetypes.ts), which IS the printed grant and is what their side encodes
   * (three SPELL selects on castingSource OATIA_SKYSAGE plus a matching giveSpellSlot). Measured,
   * carrying both gave the character an `innate-casting` entry holding Object Reading ON TOP OF the
   * archetype's own rank-1 repertoire slot — one clause, two castings.
   * ⚠ `duplicate-pick-check.mjs` did NOT catch this: it compares this registry against the record's
   * own effectChoices/choice, and this record has neither. It has no rule about a registry pick
   * colliding with an ARCHETYPE REPERTOIRE.
   * The two-option restriction is not re-homed here: this lane cannot express a repertoire filter. */
  'bone-magic': { prompt: "Choose an occult or primal cantrip", traditionFromChoiceFlag: 'boneMagicTradition', options: ['approximate', 'bullhorn', 'caustic-blast', 'daze', 'deep-breath', 'detect-magic', 'detect-metal', 'draw-moisture', 'eat-fire', 'electric-arc', 'figment', 'forbidding-ward', 'frostbite', 'gale-blast', 'glamorize', 'glass-shield', 'gouging-claw', 'guidance', 'haunting-hymn', 'healing-plaster', 'ignition', 'illuminate', 'infectious-enthusiasm', 'know-the-way', 'light', 'live-wire', 'message', 'musical-accompaniment', 'needle-darts', 'phase-bolt', 'prestidigitation', 'protect-companion', 'puff-of-poison', 'read-aura', 'read-the-air', 'root-reading', 'rousing-splash', 'scatter-scree', 'shield', 'sigil', 'slashing-gust', 'spout', 'stabilize', 'summon-instrument', 'take-root', 'tame', 'tangle-vine', 'telekinetic-hand', 'telekinetic-projectile', 'timber', 'time-sense', 'tremor-signs', 'vitality-lash', 'void-warp', 'warp-step', 'wash-your-luck'] },
  'celestial-magic': { prompt: "Choose a spell", tradition: 'divine', options: ['clear-mind', 'sure-footing', 'share-life', 'revealing-light', 'humanoid-form', 'everlight'] },
  // 'colugos-traversal' — moved to the record's own effectChoices, which can carry the printed
  // heightening (*"at 9th level, these spells are heightened to 3rd rank"*). This lane cannot: it
  // pushes a bare {spellId, tradition}, so the spell stayed rank 1 from 5th to 20th.
  'cycle-spell': { prompt: "Choose a spell to cast once per day as a divine innate spell", tradition: 'divine', options: ['bless', 'infuse-vitality', 'heal'] },
  'dragon-spit': { prompt: "Choose a cantrip", tradition: 'arcane', options: ['caustic-blast', 'electric-arc', 'ignition', 'frostbite'] },
  'dream-magic': { prompt: "Choose Dream Message or Sleep", tradition: 'occult', options: ['dream-message', 'sleep'] },
  // 'empathic-calm' — removed; its own effectChoices carries the pick WITH heightenHalfLevel, which
  // this lane cannot express. Two live lanes meant two prompts and, on differing answers, two spells.
  'expanded-runelord-magic': { prompt: "Choose a spell", tradition: 'arcane', options: ['darkvision', 'mystic-armor', 'runic-body', 'runic-weapon', 'see-the-unseen', 'sending', 'truesight', 'contingency', 'spell-riposte'] },
  'extraplanar-supplication': { prompt: "Choose a spell", tradition: 'divine', options: ['bless', 'bane'] },
  'fey-influence': { prompt: "Choose a fey influence", tradition: 'primal', options: ['grim-tendrils', 'pest-form', 'ill-omen', 'summon-plant-or-fungus', 'fleet-step', 'bane', 'spider-sting', 'heal'] },
  'fiendish-magic': { prompt: "Choose a spell", tradition: 'divine', options: ['paranoia', 'shatter', 'disguise-magic', 'see-the-unseen', 'false-vitality', 'invisibility'] },
  'first-world-magic': { prompt: "Choose a primal cantrip", tradition: 'primal', options: ['caustic-blast', 'deep-breath', 'detect-magic', 'detect-metal', 'draw-moisture', 'eat-fire', 'electric-arc', 'frostbite', 'gale-blast', 'glamorize', 'glass-shield', 'gouging-claw', 'guidance', 'ignition', 'illuminate', 'know-the-way', 'light', 'live-wire', 'needle-darts', 'prestidigitation', 'puff-of-poison', 'read-aura', 'root-reading', 'rousing-splash', 'scatter-scree', 'sigil', 'slashing-gust', 'spout', 'stabilize', 'take-root', 'tangle-vine', 'timber', 'tremor-signs', 'vitality-lash'] },
  'font-of-life-or-death': { prompt: "Choose Heal or Harm", options: ['heal', 'harm'] },
  'hag-magic': { prompt: "Choose a spell", tradition: 'occult', options: ['augury', 'charm', 'clairaudience', 'clairvoyance', 'dream-message', 'illusory-disguise', 'humanoid-form', 'water-walk', 'honeyed-words', 'outcasts-curse', 'nightmare', 'earthbind', 'solid-fog', 'hydraulic-torrent'] },
  'kitsune-spell-expertise': { prompt: "Choose a 5th-rank divine innate spell (1/day)", tradition: 'divine', options: ['confusion', 'death-ward', 'illusory-scene'] },
  'kitsune-spell-familiarity': { prompt: "Choose a cantrip", tradition: 'divine', options: ['daze', 'forbidding-ward', 'figment'] },
  'kitsune-spell-mysteries': { prompt: "Choose a spell", tradition: 'divine', options: ['bane', 'illusory-object', 'sanctuary'] },
  'light-bending-jewel': { prompt: "Choose a spell", tradition: 'occult', options: ['invisibility', 'translocate'] },
  /* *"the spell's tradition is determined by the tradition tied to your warmask"* — the answer lives
   * on Orc Warmask, which is why this names a FLAG rather than a tradition. Without it build.ts:6283
   * fell back to the SPELL's first tradition, so a divine warmask cast Fear as arcane. Wanderer's
   * Guide encodes the same thing as four per-warmask conditionals. */
  'mask-of-power': { prompt: "Choose Fear, Phantom Pain, or Sure Strike (1st-rank innate spell, 1/day, cast via your warmask)", traditionFromChoiceFlag: 'warmaskTradition', options: ['fear', 'phantom-pain', 'sure-strike'] },
  // 'merge-with-the-source' — removed; its own effectChoices carries the pick with rank 7 per option,
  // which this lane cannot express. Two live lanes granted two forms to a player who answered both.
  'methodical-magic': { prompt: "Choose a spell", tradition: 'divine', options: ['calm', 'lock', 'mending', 'shape-wood', 'translate', 'dispel-magic'] },
  'nagaji-spell-expertise': { prompt: "Choose a spell", tradition: 'occult', options: ['flicker', 'control-water', 'subconscious-suggestion'] },
  'nagaji-spell-familiarity': { prompt: "Choose a cantrip", tradition: 'occult', options: ['daze', 'detect-magic', 'telekinetic-hand'] },
  'nagaji-spell-mysteries': { prompt: "Choose a spell", tradition: 'occult', options: ['charm', 'fleet-step', 'heal'] },
  'natural-illusionist': { prompt: "Choose a spell", options: ['illusory-disguise', 'item-facade', 'illusory-object'] },
  'open-mind': { prompt: "Choose an occult cantrip", tradition: 'occult', options: ['join-pasts', 'approximate', 'infectious-enthusiasm', 'protect-companion', 'read-the-air', 'tame', 'wash-your-luck', 'invoke-true-name', 'inside-ropes', 'musical-accompaniment', 'tremor-signs', 'eat-fire', 'illuminate', 'detect-metal', 'needle-darts', 'glowing-trail', 'daze', 'detect-magic', 'figment', 'forbidding-ward', 'guidance', 'know-the-way', 'light', 'message', 'prestidigitation', 'read-aura', 'shield', 'sigil', 'summon-instrument', 'telekinetic-hand', 'telekinetic-projectile', 'void-warp', 'bullhorn', 'haunting-hymn', 'glamorize', 'phase-bolt', 'warp-step', 'time-sense'] },
  'otherworldly-magic': { prompt: "Choose an arcane cantrip", tradition: 'arcane', options: ['approximate', 'bullhorn', 'caustic-blast', 'daze', 'deep-breath', 'detect-magic', 'detect-metal', 'draw-moisture', 'eat-fire', 'electric-arc', 'figment', 'frostbite', 'gale-blast', 'glamorize', 'glass-shield', 'gouging-claw', 'ignition', 'illuminate', 'infectious-enthusiasm', 'light', 'live-wire', 'message', 'musical-accompaniment', 'needle-darts', 'phase-bolt', 'prestidigitation', 'protect-companion', 'puff-of-poison', 'read-aura', 'root-reading', 'scatter-scree', 'shield', 'sigil', 'slashing-gust', 'spout', 'summon-instrument', 'take-root', 'tangle-vine', 'telekinetic-hand', 'telekinetic-projectile', 'timber', 'time-sense', 'tremor-signs', 'void-warp', 'warp-step'] },
  // *"Choose one cantrip from the divine spell list."* — the WHOLE list, and the enumeration here had
  // quietly drifted four short of it (approximate, protect-companion, read-the-air, wash-your-luck).
  // Regenerated 2026-08-19 as every common divine non-focus cantrip the DB ships; if cantrips are ever
  // added, this list needs the same regeneration — the shape offers no open filter.
  'pantheon-magic': { prompt: "Choose a divine cantrip", tradition: 'divine', options: ['approximate', 'bullhorn', 'daze', 'detect-magic', 'detect-metal', 'divine-lance', 'draw-moisture', 'forbidding-ward', 'glamorize', 'guidance', 'haunting-hymn', 'illuminate', 'know-the-way', 'light', 'message', 'needle-darts', 'prestidigitation', 'protect-companion', 'read-aura', 'read-the-air', 'rousing-splash', 'shield', 'sigil', 'stabilize', 'summon-instrument', 'tremor-signs', 'vitality-lash', 'void-warp', 'wash-your-luck'] },
  // WG's 18 giveSpell targets one for one — the twelve standard psi cantrips PLUS the six unique
  // surface cantrips, which is what *"a psi cantrip from a conscious mind other than your own"* means.
  // `tradition: 'occult'` encodes their castingSource PSYCHIC (psychic casting is occult) and is
  // load-bearing for the six unique cantrips, whose `traditions` is [] so the innate entry's
  // tradition vote would otherwise see nothing.
  'parallel-breakthrough': { prompt: "Choose a psi cantrip from a conscious mind other than your own", tradition: 'occult', options: ['daze', 'detect-magic', 'distortion-lens', 'figment', 'forbidden-thought', 'frostbite', 'glimpse-weakness', 'guidance', 'ignition', 'imaginary-weapon', 'message', 'phase-bolt', 'shield', 'telekinetic-hand', 'telekinetic-projectile', 'telekinetic-rend', 'thermal-stasis', 'warp-step'] },
  'reclaimant-plea': { prompt: "Choose a spell (Reclaimant Plea)", tradition: 'divine', options: ['air-walk', 'planar-tether', 'unfettered-movement', 'cleanse-affliction', 'holy-light'] },
  'reprisal-of-the-fallen': { prompt: "Choose Invoke Spirits or Wails of the Damned", tradition: 'occult', options: ['invoke-spirits', 'wails-of-the-damned'] },
  'runescarred-dedication': { prompt: "Choose a cantrip from the arcane list", tradition: 'arcane', options: ['caustic-blast', 'ancient-dust', 'approximate', 'bramble-bush', 'bullhorn', 'daze', 'deep-breath', 'detect-magic', 'detect-metal', 'draw-moisture', 'eat-fire', 'electric-arc', 'elemental-counter', 'figment', 'frostbite', 'frosts-touch', 'gale-blast', 'glamorize', 'glass-shield', 'glowing-trail', 'gouging-claw', 'ignition', 'illuminate', 'infectious-enthusiasm', 'invoke-true-name', 'light', 'live-wire', 'message', 'musical-accompaniment', 'needle-darts', 'phase-bolt', 'prestidigitation', 'protect-companion', 'puff-of-poison', 'read-aura', 'root-reading', 'scatter-scree', 'shield', 'sigil', 'slashing-gust', 'spout', 'summon-instrument', 'take-root', 'tangle-vine', 'telekinetic-hand', 'telekinetic-projectile', 'timber', 'time-sense', 'torturous-trauma', 'tremor-signs', 'void-warp', 'warp-step'] },
  'shrouded-magic': { prompt: "Choose an occult cantrip", tradition: 'occult', options: ['daze', 'detect-magic', 'figment', 'forbidding-ward', 'guidance', 'know-the-way', 'light', 'message', 'prestidigitation', 'read-aura', 'shield', 'sigil', 'summon-instrument', 'telekinetic-hand', 'telekinetic-projectile', 'void-warp', 'bullhorn', 'haunting-hymn', 'phase-bolt', 'warp-step', 'time-sense', 'glamorize', 'musical-accompaniment', 'tremor-signs', 'eat-fire', 'illuminate', 'detect-metal', 'needle-darts'] },
  'speaker-in-training': { prompt: "Choose your Speaker path: Bless (Faithspeaker, divine) or Fleet Step (Greenspeaker, primal)", traditionByOption: { "bless": "divine", "fleet-step": "primal" }, options: ['bless', 'fleet-step'] },
  // 'spiritual-echo' — removed; its own effectChoices carries the pick with rank 4 per option, which
  // this lane cannot express. Two live lanes granted two clan spells to a player who answered both.
  'studious-magic': { prompt: "Choose an arcane cantrip", tradition: 'arcane', options: ['caustic-blast', 'ancient-dust', 'approximate', 'bramble-bush', 'bullhorn', 'daze', 'deep-breath', 'detect-magic', 'detect-metal', 'draw-moisture', 'eat-fire', 'electric-arc', 'elemental-counter', 'figment', 'frostbite', 'frosts-touch', 'gale-blast', 'glamorize', 'glass-shield', 'glowing-trail', 'gouging-claw', 'ignition', 'illuminate', 'infectious-enthusiasm', 'invoke-true-name', 'light', 'live-wire', 'message', 'musical-accompaniment', 'needle-darts', 'phase-bolt', 'prestidigitation', 'protect-companion', 'puff-of-poison', 'read-aura', 'root-reading', 'scatter-scree', 'shield', 'sigil', 'slashing-gust', 'spout', 'summon-instrument', 'take-root', 'tangle-vine', 'telekinetic-hand', 'telekinetic-projectile', 'timber', 'time-sense', 'torturous-trauma', 'tremor-signs', 'void-warp', 'warp-step'] },
  'summon-nephilim-kin': { prompt: "Choose a summoning spell", tradition: 'divine', options: ['summon-celestial', 'summon-fiend'] },
  /*
   * REMOVED — the record's own `effectChoices` carries this pick now, and BOTH lanes were live.
   *
   * The builder renders a picker for any feat in this registry AND a second one for the record's
   * `effectChoices`, and buildCharacter pushes both answers into the innate grants, deduping only by
   * spell id. A sarangay who answered one picker Illusory Object and the other Invisible Item came away
   * with TWO occult innate spells at 1/day from a clause that grants exactly one.
   *
   * Left as a comment rather than deleted silently: the id must not come back here while the record
   * carries the choice.
   */
  // 'the-moon-weavers-art' — moved to the record's own effectChoices; two live lanes double-granted.
  'touch-of-the-sea': { prompt: "Choose gale blast or spout", tradition: 'primal', options: ['gale-blast', 'spout'] },
  'transcendent-realization': { prompt: "Choose a 3rd-rank occult spell", tradition: 'occult', options: ['agonizing-despair', 'behold-the-weave', 'bind-undead', 'blindness', 'bottomless-stomach', 'bracing-tendrils', 'claim-curse', 'clairaudience', 'cozy-cabin', 'cup-of-dust', 'curse-of-lost-time', 'days-weight', 'distracting-chatter', 'dream-message', 'enthrall', 'familiars-face', 'focusing-hum', 'ghostly-weapon', 'gravity-well', 'haste', 'heroism', 'hypercognition', 'hypnotize', 'impending-doom', 'lashing-rope', 'levitate', 'mind-of-menace', 'moths-supper', 'oneiric-mire', 'ooze-form', 'organsight', 'paralyze', 'phantom-prison', 'roaring-applause', 'rouse-skeletons', 'scrying-ripples', 'sculpt-sound', 'sea-of-thought', 'secret-page', 'shadow-projectile', 'shadow-spy', 'shared-invisibility', 'shift-blame', 'slow', 'speak-with-plants', 'threefold-aspect', 'time-jump', 'time-pocket', 'vampiric-feast', 'wall-of-shadow', 'wanderers-guide', 'web-of-eyes', 'whirling-scarves', 'wooden-double'] },
  'unlock-secret': { prompt: "Choose a 1st-rank occult spell", tradition: 'occult', options: ['agitate', 'alarm', 'animate-rope', 'anticipate-peril', 'bane', 'befuddle', 'biting-words', 'bless', 'breadcrumbs', 'carryall', 'charm', 'command', 'concordant-choir', 'curse-of-recoil', 'de-ja-vu', 'disguise-magic', 'dizzying-colors', 'draw-ire', 'echoing-weapon', 'endure', 'enfeeble', 'fashionista', 'fear', 'force-barrage', 'forced-mercy', 'gravitational-pull', 'grim-tendrils', 'helpful-steps', 'ill-omen', 'illusory-disguise', 'illusory-object', 'imprint-message', 'invisible-item', 'item-facade', 'kinetic-ram', 'liberating-command', 'lock', 'lose-the-path', 'mending', 'message-rune', 'mindlink', 'mystic-armor', 'object-reading', 'penumbral-shroud', 'pet-cache', 'phantasmal-minion', 'phantom-pain', 'protection', 'quick-sort', 'restyle', 'runic-body', 'runic-weapon', 'sanctuary', 'schadenfreude', 'seashell-of-stolen-sound', 'share-lore', 'signal-skyrocket', 'sleep', 'soothe', 'spirit-link', 'summon-fey', 'summon-undead', 'sure-strike', 'synchronize', 'thicket-of-knives', 'thoughtful-gift', 'ventriloquism'] },
  'vigilant-benediction': { prompt: "Choose a spell (Vigilant Benediction)", tradition: 'divine', options: ['unfettered-movement', 'cleanse-affliction', 'resist-energy', 'spell-immunity', 'status', 'oaken-resilience', 'fire-shield', 'mountain-resilience', 'mystic-armor', 'wall-of-fire'] },
  'wildborn-magic': { prompt: "Choose a primal cantrip", tradition: 'primal', options: ['caustic-blast', 'approximate', 'bramble-bush', 'deep-breath', 'detect-magic', 'detect-metal', 'draw-moisture', 'eat-fire', 'electric-arc', 'elemental-counter', 'frostbite', 'gale-blast', 'glamorize', 'glass-shield', 'glowing-trail', 'gouging-claw', 'guidance', 'healing-plaster', 'ignition', 'illuminate', 'inside-ropes', 'invoke-true-name', 'know-the-way', 'light', 'live-wire', 'needle-darts', 'prestidigitation', 'protect-companion', 'puff-of-poison', 'read-aura', 'root-reading', 'rousing-splash', 'scatter-scree', 'sigil', 'slashing-gust', 'spout', 'stabilize', 'take-root', 'tame', 'tangle-vine', 'timber', 'tremor-signs', 'vitality-lash'] },
  'words-of-unraveling': { prompt: "Choose an occult curse spell (1/day)", tradition: 'occult', options: ['daydreamers-curse', 'outcasts-curse', 'sages-curse'] }

};
