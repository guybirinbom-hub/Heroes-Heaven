/*
 * Cleric domain → initial domain (focus) spell, granted by Domain Initiate.
 *
 * The domain→spell link is Foundry system-code config, not in the packs (domain
 * spells carry only cleric+focus traits, no domain trait). Authored from the
 * published domain list; every spell id below is verified to exist in the imported
 * spells. Uncommon/apocryphal domains without a confident mapping are omitted —
 * Domain Initiate on those simply grants no spell here (rare, and never wrong).
 */
export const DOMAIN_SPELLS: Record<string, string> = {
  air: 'pushing-gust',
  ambition: 'ignite-ambition',
  cities: 'face-in-the-crowd',
  cold: 'winter-bolt',
  confidence: 'veil-of-confidence',
  creation: 'creative-splash',
  death: 'deaths-call',
  destruction: 'cry-of-destruction',
  dragon: 'draconic-barrage',
  dreams: 'sweet-dream',
  earth: 'hurtling-stone',
  family: 'soothing-words',
  fate: 'read-fate',
  fire: 'fire-ray',
  freedom: 'unimpeded-stride',
  healing: 'healers-blessing',
  indulgence: 'overstuff',
  introspection: 'guided-introspection',
  knowledge: 'scholarly-recollection',
  luck: 'bit-of-luck',
  magic: 'magics-vessel',
  might: 'athletic-rush',
  moon: 'moonbeam',
  nature: 'vibrant-thorns',
  nightmares: 'waking-nightmare',
  pain: 'savor-the-sting',
  passion: 'charming-touch',
  perfection: 'perfected-mind',
  plague: 'divine-plagues',
  protection: 'protectors-sacrifice',
  // The Remaster renamed Forced Quiet to Whispering Quiet, and the app marks the old id
  // `superseded`, so this mapping handed a Secrecy cleric a spell the app hides from them.
  secrecy: 'whispering-quiet',
  star: 'zenith-star',
  sun: 'dazzling-flash',
  swarm: 'swarmsense',
  travel: 'agile-feet',
  trickery: 'sudden-shift',
  truth: 'word-of-truth',
  tyranny: 'touch-of-obedience',
  undeath: 'touch-of-undeath',
  water: 'tidal-surge',
  wealth: 'appearance-of-wealth',
  zeal: 'weapon-surge',
  /* ---- completed from the mirror's own domain records (21) ----------------------------
   * The comment above said the omitted domains were "uncommon/apocryphal … without a confident
   * mapping". They were neither: Duty is carried by 71 deities, Change by 67, Darkness by 50, and a
   * cleric of any of them who took Domain Initiate received no focus spell at all. The mapping is not
   * a judgement call either — AoN files each domain as its own record with its initial and advanced
   * spells named, and Advanced Domain in this same data already offers all 64.
   */
  abomination: 'lift-natures-caul',
  change: 'adapt-self',
  darkness: 'cloak-of-shadow',
  decay: 'withering-grasp',
  disorientation: 'clouded-focus',
  // `delirium` is the legacy Gods & Magic name for the same domain, and 17 deity records still carry
  // it. Its printed initial spell was Hyperfocus, which the Remaster replaced with Clouded Focus and
  // which this data does not have — so the alias points at the replacement rather than at nothing.
  delirium: 'clouded-focus',
  dust: 'parch',
  duty: 'swear-oath',
  glyph: 'redact',
  lightning: 'charged-javelin',
  metal: 'serrate',
  naga: 'chastising-retort',
  nothingness: 'empty-inside',
  repose: 'share-burden',
  sorrow: 'lament',
  soul: 'eject-soul',
  time: 'delay-consequence',
  toil: 'practice-makes-perfect',
  vigil: 'object-memory',
  // void is the legacy name for nothingness; both spellings appear on deity records.
  void: 'empty-inside',
  wood: 'arms-of-nature',
  // wyrmkin is the legacy name for dragon; both spellings appear on deity records.
  wyrmkin: 'draconic-barrage',
};
