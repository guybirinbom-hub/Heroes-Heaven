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
  'arcane-tattoos': { prompt: "Choose a cantrip", tradition: 'arcane', options: ['shield', 'tangle-vine', 'daze', 'electric-arc', 'ghost-sound', 'void-warp', 'sigil'] },
  'awakened-jewel': { prompt: "Choose an occult cantrip", tradition: 'occult', options: ['approximate', 'bullhorn', 'daze', 'detect-magic', 'detect-metal', 'eat-fire', 'figment', 'forbidding-ward', 'glamorize', 'guidance', 'haunting-hymn', 'illuminate', 'infectious-enthusiasm', 'know-the-way', 'light', 'message', 'musical-accompaniment', 'needle-darts', 'phase-bolt', 'prestidigitation', 'protect-companion', 'read-aura', 'read-the-air', 'shield', 'sigil', 'summon-instrument', 'tame', 'telekinetic-hand', 'telekinetic-projectile', 'time-sense', 'tremor-signs', 'void-warp', 'warp-step', 'wash-your-luck'] },
  'awakened-magic': { prompt: "Choose a primal cantrip", tradition: 'primal', options: ['approximate', 'caustic-blast', 'deep-breath', 'detect-magic', 'detect-metal', 'draw-moisture', 'eat-fire', 'electric-arc', 'frostbite', 'gale-blast', 'glamorize', 'glass-shield', 'gouging-claw', 'guidance', 'healing-plaster', 'ignition', 'illuminate', 'know-the-way', 'light', 'live-wire', 'needle-darts', 'prestidigitation', 'protect-companion', 'puff-of-poison', 'read-aura', 'root-reading', 'rousing-splash', 'scatter-scree', 'sigil', 'slashing-gust', 'spout', 'stabilize', 'take-root', 'tame', 'tangle-vine', 'timber', 'tremor-signs', 'vitality-lash'] },
  'basic-skysage-divination': { prompt: "Choose a 1st-rank spell", tradition: 'occult', options: ['object-reading', 'sure-strike'] },
  'bone-magic': { prompt: "Choose an occult or primal cantrip", traditionFromChoiceFlag: 'boneMagicTradition', options: ['approximate', 'bullhorn', 'caustic-blast', 'daze', 'deep-breath', 'detect-magic', 'detect-metal', 'draw-moisture', 'eat-fire', 'electric-arc', 'figment', 'forbidding-ward', 'frostbite', 'gale-blast', 'glamorize', 'glass-shield', 'gouging-claw', 'guidance', 'haunting-hymn', 'healing-plaster', 'ignition', 'illuminate', 'infectious-enthusiasm', 'know-the-way', 'light', 'live-wire', 'message', 'musical-accompaniment', 'needle-darts', 'phase-bolt', 'prestidigitation', 'protect-companion', 'puff-of-poison', 'read-aura', 'read-the-air', 'root-reading', 'rousing-splash', 'scatter-scree', 'shield', 'sigil', 'slashing-gust', 'spout', 'stabilize', 'summon-instrument', 'take-root', 'tame', 'tangle-vine', 'telekinetic-hand', 'telekinetic-projectile', 'timber', 'time-sense', 'tremor-signs', 'vitality-lash', 'void-warp', 'warp-step', 'wash-your-luck'] },
  'celestial-magic': { prompt: "Choose a spell", tradition: 'divine', options: ['clear-mind', 'sure-footing', 'share-life', 'revealing-light', 'humanoid-form', 'everlight'] },
  'colugos-traversal': { prompt: "Choose a spell", tradition: 'primal', options: ['gentle-landing', 'jump'] },
  'cycle-spell': { prompt: "Choose a spell to cast once per day as a divine innate spell", tradition: 'divine', options: ['bless', 'infuse-vitality', 'heal'] },
  'dragon-spit': { prompt: "Choose a cantrip", tradition: 'arcane', options: ['acid-splash', 'electric-arc', 'ignition', 'ray-of-frost'] },
  'dream-magic': { prompt: "Choose Dream Message or Sleep", tradition: 'occult', options: ['dream-message', 'sleep'] },
  'empathic-calm': { prompt: "Choose Calm or Sanctuary", tradition: 'occult', options: ['calm', 'sanctuary'] },
  'expanded-runelord-magic': { prompt: "Choose a spell", tradition: 'arcane', options: ['darkvision', 'mystic-armor', 'runic-body', 'runic-weapon', 'see-the-unseen', 'sending', 'truesight', 'contingency', 'spell-riposte'] },
  'extraplanar-supplication': { prompt: "Choose a spell", tradition: 'divine', options: ['bless', 'bane'] },
  'fey-influence': { prompt: "Choose a fey influence", tradition: 'primal', options: ['grim-tendrils', 'pest-form', 'ill-omen', 'summon-plant-or-fungus', 'fleet-step', 'bane', 'spider-sting', 'heal'] },
  'fiendish-magic': { prompt: "Choose a spell", tradition: 'divine', options: ['paranoia', 'shatter', 'disguise-magic', 'see-the-unseen', 'false-vitality', 'invisibility'] },
  'first-world-magic': { prompt: "Choose a primal cantrip", tradition: 'primal', options: ['caustic-blast', 'deep-breath', 'detect-magic', 'detect-metal', 'draw-moisture', 'eat-fire', 'electric-arc', 'frostbite', 'gale-blast', 'glamorize', 'glass-shield', 'gouging-claw', 'guidance', 'ignition', 'illuminate', 'know-the-way', 'light', 'live-wire', 'needle-darts', 'prestidigitation', 'puff-of-poison', 'read-aura', 'root-reading', 'rousing-splash', 'scatter-scree', 'sigil', 'slashing-gust', 'spout', 'stabilize', 'take-root', 'tangle-vine', 'timber', 'tremor-signs', 'vitality-lash'] },
  'font-of-life-or-death': { prompt: "Choose Heal or Harm", options: ['heal', 'harm'] },
  'hag-magic': { prompt: "Choose a spell", tradition: 'occult', options: ['augury', 'charm', 'clairaudience', 'clairvoyance', 'dream-message', 'illusory-disguise', 'humanoid-form', 'water-walk', 'honeyed-words', 'outcasts-curse', 'nightmare', 'earthbind', 'solid-fog', 'hydraulic-torrent'] },
  'kitsune-spell-expertise': { prompt: "Choose a 5th-rank divine innate spell (1/day)", tradition: 'divine', options: ['confusion', 'death-ward', 'illusory-scene'] },
  'kitsune-spell-familiarity': { prompt: "Choose a cantrip", tradition: 'divine', options: ['daze', 'forbidding-ward', 'ghost-sound'] },
  'kitsune-spell-mysteries': { prompt: "Choose a spell", tradition: 'divine', options: ['bane', 'illusory-object', 'sanctuary'] },
  'light-bending-jewel': { prompt: "Choose a spell", tradition: 'occult', options: ['invisibility', 'translocate'] },
  'mask-of-power': { prompt: "Choose Fear, Phantom Pain, or Sure Strike (1st-rank innate spell, 1/day, cast via your warmask)", options: ['fear', 'phantom-pain', 'sure-strike'] },
  'merge-with-the-source': { prompt: "Choose a spell", traditionByOption: {"angel-form":"divine","daemon-form":"divine","demon-form":"divine","devil-form":"divine","elemental-form":"primal","plant-form":"primal"}, options: ['angel-form', 'daemon-form', 'demon-form', 'devil-form', 'elemental-form', 'plant-form'] },
  'methodical-magic': { prompt: "Choose a spell", tradition: 'divine', options: ['calm', 'lock', 'mending', 'shape-wood', 'translate', 'dispel-magic'] },
  'nagaji-spell-expertise': { prompt: "Choose a spell", tradition: 'occult', options: ['flicker', 'control-water', 'subconscious-suggestion'] },
  'nagaji-spell-familiarity': { prompt: "Choose a cantrip", tradition: 'occult', options: ['daze', 'detect-magic', 'telekinetic-hand'] },
  'nagaji-spell-mysteries': { prompt: "Choose a spell", tradition: 'occult', options: ['charm', 'fleet-step', 'heal'] },
  'natural-illusionist': { prompt: "Choose a spell", options: ['illusory-disguise', 'item-facade', 'illusory-object'] },
  'open-mind': { prompt: "Choose an occult cantrip", tradition: 'occult', options: ['join-pasts', 'approximate', 'infectious-enthusiasm', 'protect-companion', 'read-the-air', 'tame', 'wash-your-luck', 'invoke-true-name', 'inside-ropes', 'musical-accompaniment', 'tremor-signs', 'eat-fire', 'illuminate', 'detect-metal', 'needle-darts', 'glowing-trail', 'daze', 'detect-magic', 'figment', 'forbidding-ward', 'guidance', 'know-the-way', 'light', 'message', 'prestidigitation', 'read-aura', 'shield', 'sigil', 'summon-instrument', 'telekinetic-hand', 'telekinetic-projectile', 'void-warp', 'bullhorn', 'haunting-hymn', 'glamorize', 'phase-bolt', 'warp-step', 'time-sense', 'ghost-sound'] },
  'otherworldly-magic': { prompt: "Choose an arcane cantrip", tradition: 'arcane', options: ['approximate', 'bullhorn', 'caustic-blast', 'daze', 'deep-breath', 'detect-magic', 'detect-metal', 'draw-moisture', 'eat-fire', 'electric-arc', 'figment', 'frostbite', 'gale-blast', 'glamorize', 'glass-shield', 'gouging-claw', 'ignition', 'illuminate', 'infectious-enthusiasm', 'light', 'live-wire', 'message', 'musical-accompaniment', 'needle-darts', 'phase-bolt', 'prestidigitation', 'protect-companion', 'puff-of-poison', 'read-aura', 'root-reading', 'scatter-scree', 'shield', 'sigil', 'slashing-gust', 'spout', 'summon-instrument', 'take-root', 'tangle-vine', 'telekinetic-hand', 'telekinetic-projectile', 'timber', 'time-sense', 'tremor-signs', 'void-warp', 'warp-step'] },
  'pantheon-magic': { prompt: "Choose a divine cantrip", tradition: 'divine', options: ['bullhorn', 'daze', 'detect-magic', 'detect-metal', 'divine-lance', 'draw-moisture', 'forbidding-ward', 'glamorize', 'guidance', 'haunting-hymn', 'illuminate', 'know-the-way', 'light', 'message', 'needle-darts', 'prestidigitation', 'read-aura', 'rousing-splash', 'shield', 'sigil', 'stabilize', 'summon-instrument', 'tremor-signs', 'vitality-lash', 'void-warp'] },
  'parallel-breakthrough': { prompt: "Choose a cantrip", options: ['daze', 'detect-magic', 'figment', 'frostbite', 'guidance', 'ignition', 'message', 'phase-bolt', 'shield', 'telekinetic-hand', 'telekinetic-projectile', 'warp-step'] },
  'reclaimant-plea': { prompt: "Choose a spell (Reclaimant Plea)", tradition: 'divine', options: ['air-walk', 'planar-tether', 'unfettered-movement', 'cleanse-affliction', 'holy-light'] },
  'reprisal-of-the-fallen': { prompt: "Choose Invoke Spirits or Wails of the Damned", tradition: 'occult', options: ['invoke-spirits', 'wails-of-the-damned'] },
  'runescarred-dedication': { prompt: "Choose a cantrip from the arcane list", tradition: 'arcane', options: ['acid-splash', 'ancient-dust', 'approximate', 'bramble-bush', 'bullhorn', 'caustic-blast', 'daze', 'deep-breath', 'detect-magic', 'detect-metal', 'draw-moisture', 'eat-fire', 'electric-arc', 'elemental-counter', 'figment', 'frostbite', 'frosts-touch', 'gale-blast', 'ghost-sound', 'glamorize', 'glass-shield', 'glowing-trail', 'gouging-claw', 'ignition', 'illuminate', 'infectious-enthusiasm', 'invoke-true-name', 'light', 'live-wire', 'message', 'musical-accompaniment', 'needle-darts', 'phase-bolt', 'prestidigitation', 'protect-companion', 'puff-of-poison', 'ray-of-frost', 'read-aura', 'root-reading', 'scatter-scree', 'shield', 'sigil', 'slashing-gust', 'spout', 'summon-instrument', 'take-root', 'tangle-vine', 'telekinetic-hand', 'telekinetic-projectile', 'timber', 'time-sense', 'torturous-trauma', 'tremor-signs', 'void-warp', 'warp-step'] },
  'shrouded-magic': { prompt: "Choose an occult cantrip", tradition: 'occult', options: ['daze', 'detect-magic', 'figment', 'forbidding-ward', 'guidance', 'know-the-way', 'light', 'message', 'prestidigitation', 'read-aura', 'shield', 'sigil', 'summon-instrument', 'telekinetic-hand', 'telekinetic-projectile', 'void-warp', 'bullhorn', 'haunting-hymn', 'phase-bolt', 'warp-step', 'time-sense', 'glamorize', 'musical-accompaniment', 'tremor-signs', 'eat-fire', 'illuminate', 'detect-metal', 'needle-darts'] },
  'speaker-in-training': { prompt: "Choose your Speaker path: Bless (Faithspeaker, divine) or Fleet Step (Greenspeaker, primal)", traditionByOption: {"bless":"divine","fleet-step":"primal"}, options: ['bless', 'fleet-step'] },
  'spiritual-echo': { prompt: "Choose your head gem's clan spell (cast as a 4th-rank occult innate spell once per day)", tradition: 'occult', options: ['spirit-sense', 'status', 'darkness', 'creation', 'blood-vendetta'] },
  'studious-magic': { prompt: "Choose an arcane cantrip", tradition: 'arcane', options: ['acid-splash', 'ancient-dust', 'approximate', 'bramble-bush', 'bullhorn', 'caustic-blast', 'daze', 'deep-breath', 'detect-magic', 'detect-metal', 'draw-moisture', 'eat-fire', 'electric-arc', 'elemental-counter', 'figment', 'frostbite', 'frosts-touch', 'gale-blast', 'ghost-sound', 'glamorize', 'glass-shield', 'glowing-trail', 'gouging-claw', 'ignition', 'illuminate', 'infectious-enthusiasm', 'invoke-true-name', 'light', 'live-wire', 'message', 'musical-accompaniment', 'needle-darts', 'phase-bolt', 'prestidigitation', 'protect-companion', 'puff-of-poison', 'ray-of-frost', 'read-aura', 'root-reading', 'scatter-scree', 'shield', 'sigil', 'slashing-gust', 'spout', 'summon-instrument', 'take-root', 'tangle-vine', 'telekinetic-hand', 'telekinetic-projectile', 'timber', 'time-sense', 'torturous-trauma', 'tremor-signs', 'void-warp', 'warp-step'] },
  'summon-nephilim-kin': { prompt: "Choose a summoning spell", tradition: 'divine', options: ['summon-celestial', 'summon-fiend'] },
  'the-moon-weavers-art': { prompt: "Choose a spell", tradition: 'occult', options: ['illusory-object', 'invisible-item'] },
  'touch-of-the-sea': { prompt: "Choose gale blast or spout", tradition: 'primal', options: ['gale-blast', 'spout'] },
  'transcendent-realization': { prompt: "Choose a 3rd-rank occult spell", tradition: 'occult', options: ['agonizing-despair', 'behold-the-weave', 'bind-undead', 'blindness', 'bottomless-stomach', 'bracing-tendrils', 'claim-curse', 'clairaudience', 'cozy-cabin', 'cup-of-dust', 'curse-of-lost-time', 'days-weight', 'distracting-chatter', 'dream-message', 'enthrall', 'familiars-face', 'focusing-hum', 'ghostly-weapon', 'gravity-well', 'haste', 'heroism', 'hypercognition', 'hypnotize', 'impending-doom', 'lashing-rope', 'levitate', 'mind-of-menace', 'moths-supper', 'oneiric-mire', 'ooze-form', 'organsight', 'paralyze', 'phantom-prison', 'roaring-applause', 'rouse-skeletons', 'scrying-ripples', 'sculpt-sound', 'sea-of-thought', 'secret-page', 'shadow-projectile', 'shadow-spy', 'shared-invisibility', 'shift-blame', 'slow', 'speak-with-plants', 'threefold-aspect', 'time-jump', 'time-pocket', 'vampiric-feast', 'wall-of-shadow', 'wanderers-guide', 'web-of-eyes', 'whirling-scarves', 'wooden-double'] },
  'unlock-secret': { prompt: "Choose a 1st-rank occult spell", tradition: 'occult', options: ['agitate', 'alarm', 'animate-rope', 'anticipate-peril', 'bane', 'befuddle', 'biting-words', 'bless', 'breadcrumbs', 'carryall', 'charm', 'command', 'concordant-choir', 'curse-of-recoil', 'de-ja-vu', 'disguise-magic', 'dizzying-colors', 'draw-ire', 'echoing-weapon', 'endure', 'enfeeble', 'fashionista', 'fear', 'force-barrage', 'forced-mercy', 'gravitational-pull', 'grim-tendrils', 'helpful-steps', 'ill-omen', 'illusory-disguise', 'illusory-object', 'imprint-message', 'invisible-item', 'item-facade', 'kinetic-ram', 'liberating-command', 'lock', 'lose-the-path', 'mending', 'message-rune', 'mindlink', 'mystic-armor', 'object-reading', 'penumbral-shroud', 'pet-cache', 'phantasmal-minion', 'phantom-pain', 'protection', 'quick-sort', 'restyle', 'runic-body', 'runic-weapon', 'sanctuary', 'schadenfreude', 'seashell-of-stolen-sound', 'share-lore', 'signal-skyrocket', 'sleep', 'soothe', 'spirit-link', 'summon-fey', 'summon-undead', 'sure-strike', 'synchronize', 'thicket-of-knives', 'thoughtful-gift', 'ventriloquism'] },
  'vigilant-benediction': { prompt: "Choose a spell (Vigilant Benediction)", tradition: 'divine', options: ['unfettered-movement', 'cleanse-affliction', 'resist-energy', 'spell-immunity', 'status', 'oaken-resilience', 'fire-shield', 'mountain-resilience', 'mystic-armor', 'wall-of-fire'] },
  'wildborn-magic': { prompt: "Choose a primal cantrip", tradition: 'primal', options: ['acid-splash', 'approximate', 'bramble-bush', 'caustic-blast', 'deep-breath', 'detect-magic', 'detect-metal', 'draw-moisture', 'eat-fire', 'electric-arc', 'elemental-counter', 'frostbite', 'gale-blast', 'glamorize', 'glass-shield', 'glowing-trail', 'gouging-claw', 'guidance', 'healing-plaster', 'ignition', 'illuminate', 'inside-ropes', 'invoke-true-name', 'know-the-way', 'light', 'live-wire', 'needle-darts', 'prestidigitation', 'protect-companion', 'puff-of-poison', 'ray-of-frost', 'read-aura', 'root-reading', 'rousing-splash', 'scatter-scree', 'sigil', 'slashing-gust', 'spout', 'stabilize', 'take-root', 'tame', 'tangle-vine', 'timber', 'tremor-signs', 'vitality-lash'] },
  'words-of-unraveling': { prompt: "Choose an occult curse spell (1/day)", tradition: 'occult', options: ['daydreamers-curse', 'outcasts-curse', 'sages-curse'] },
};
