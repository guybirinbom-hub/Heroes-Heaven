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
  secrecy: 'forced-quiet',
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
};
