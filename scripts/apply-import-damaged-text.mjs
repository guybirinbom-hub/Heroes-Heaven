/*
 * Repair descriptions whose printed values were DELETED AT IMPORT.
 *
 * The importer dropped inline numbers and words out of a large number of descriptions, leaving
 * sentences that are grammatical and wrong: Aerial Boomerang "races away from you in a . Each creature
 * in the area takes damage with a save against your class DC", Battle Medicine "The target is then to
 * your Battle Medicine for 1 day". A player reads that and cannot tell what the feat does; the audit
 * reported four of them and the sweep behind it counted many more.
 *
 * ⚠ THE PLAIN `description` IS A LIVE PLAYER SURFACE, not a fallback. MainTab's action popup renders
 * it through RichText with no ast key at all, so this text is what a player actually reads at the
 * table for every owned feat with an action cost.
 *
 * ⚠ WHY THIS WRITES BOTH FILES. The documented shortcut — append an overlay row, then run
 * import-siege-and-gaps.mjs — does NOT materialise a `description`. That sets the value on
 * public/core.json and stops; split-descriptions.mjs then sees a handful of extractable descriptions
 * against 19k already split out, calls it a catastrophic loss and exits rather than writing. So the
 * overlay row is the DURABLE record (it survives `npm run data`) and public/core-descriptions.json is
 * written directly so the repair is live now. Both, or the fix is either invisible or temporary.
 *
 *   node scripts/apply-import-damaged-text.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const fail = (m) => { console.error('REFUSED: ' + m); process.exit(1); };

/* The repairs, each transcribed from the AoN mirror. `find` must occur EXACTLY ONCE in the shipped
 * description — a substring that matches twice would repair one and corrupt the other. */
const REPAIRS = [
  { category: "classFeatures", id: "red-mantis-magic-school", find: "- **2nd** , Mist", replace: "- **2nd** Invisibility, Mist" },
  { category: "classFeatures", id: "red-mantis-magic-school", find: "- **3rd** , Paralyze", replace: "- **3rd** Clairaudience, Paralyze" },
  { category: "classFeatures", id: "red-mantis-magic-school", find: "- **4th** , Translocate", replace: "- **4th** Clairvoyance, Translocate" },
  { category: "classFeatures", id: "red-mantis-magic-school", find: "- **5th** , Illusory Scene", replace: "- **5th** Hallucination, Illusory Scene" },
  { category: "classFeatures", id: "red-mantis-magic-school", find: "- **8th** , Unrelenting Observation", replace: "- **8th** Disappearance, Unrelenting Observation" },
  { category: "classFeatures", id: "red-mantis-magic-school", find: "- **9th**\n\n**School Spells**", replace: "- **9th** Phantasmagoria\n\n**School Spells**" },
  { category: "classFeatures", id: "the-infinite-eye", find: "- 4th:\n- 5th: Scouting Eye", replace: "- 4th: Clairvoyance\n- 5th: Scouting Eye" },
  { category: "items", id: "entertainers-lute", find: "- **1st** Bless,\n", replace: "- **1st** Bless, Ventriloquism\n" },
  { category: "items", id: "entertainers-lute-greater", find: "- **1st** Bless,\n- **2nd** Calm", replace: "- **1st** Bless, Ventriloquism\n- **2nd** Calm" },
  { category: "items", id: "locket-of-sealed-nightmares", find: "(DC 41): , Sleep, or Weird.", replace: "(DC 41): Hallucination, Sleep, or Weird." },
  { category: "items", id: "snapleaf", find: "Gentle Landing and a 2nd-rank spell for 1 minute", replace: "Gentle Landing and a 2nd-rank Invisibility spell for 1 minute" },
  { category: "items", id: "the-midwife", find: "prevent a death effect or from slaying a target.", replace: "prevent a death effect or Disintegrate from slaying a target." },
  { category: "feats", id: "analyze-information", find: "You can cast 3rd-rank once per day", replace: "You can cast 3rd-rank Hypercognition once per day" },
  { category: "feats", id: "elite-dracomancer", find: "(for example, and Paralyze for a conspirator", replace: "(for example, Clairvoyance and Paralyze for a conspirator" },
  { category: "feats", id: "linguist-dedication", find: "You gain the skill feat twice.", replace: "You gain the Multilingual skill feat twice." },
  { category: "feats", id: "thrown-voice", find: "You can cast as a primal innate spell", replace: "You can cast Ventriloquism as a primal innate spell" },
  { category: "classFeatures", id: "lore", find: "- **3rd:**\n- **6th:**", replace: "- **3rd:** Hypercognition\n- **6th:**" },
  { category: "classFeatures", id: "school-of-the-reclamation", find: "- **7th:** Restore Ground,\n", replace: "- **7th:** Restore Ground, Retrocognition\n" },
  { category: "classFeatures", id: "school-of-the-reclamation", find: "- **9th:**\n", replace: "- **9th:** Metamorphosis\n" },
  { category: "items", id: "disintegration-bolt", find: "it is subject to a spell requiring a save", replace: "it is subject to a Disintegrate spell requiring a save" },
  { category: "items", id: "indestructible-shield", find: "damaged only by a spell (roll damage", replace: "damaged only by a Disintegrate spell (roll damage" },
  { category: "items", id: "ringmasters-staff-greater", find: "- **3rd** Enthrall,\n", replace: "- **3rd** Enthrall, Pyrotechnics\n" },
  { category: "items", id: "staff-of-the-unblinking-eye-greater", find: "- **4th** , Detect Scrying", replace: "- **4th** Clairvoyance, Detect Scrying" },
  { category: "items", id: "staff-of-the-unblinking-eye-major", find: "- **4th** , Detect Scrying", replace: "- **4th** Clairvoyance, Detect Scrying" },
  { category: "items", id: "vigilant-eye-greater", find: "**Effect** You cast .", replace: "**Effect** You cast Clairvoyance." },
  { category: "items", id: "vigilant-eye-major", find: "**Effect** You cast .", replace: "**Effect** You cast Clairvoyance." },
  { category: "feats", id: "distant-cackle", find: "You can cast once per day", replace: "You can cast Ventriloquism once per day" },
  { category: "feats", id: "hag-magic", find: "Charm, ,", replace: "Charm, Clairaudience," },
  { category: "feats", id: "hag-magic", find: " , Dream Message", replace: " Clairvoyance, Dream Message" },
  { category: "feats", id: "secrets-of-the-past", find: "You can cast as an occult innate spell", replace: "You can cast Hypercognition as an occult innate spell" },
  { category: "classFeatures", id: "psychopomp-eidolon", find: "Once per hour, it can cast targeting you", replace: "Once per hour, it can cast Invisibility targeting you" },
  { category: "classFeatures", id: "tempest", find: "- **1st:**\n- **4th:**", replace: "- **1st:** Thunderstrike\n- **4th:**" },
  { category: "classFeatures", id: "tempest", find: "- **advanced:**\n- **greater:**", replace: "- **advanced:** Thunderburst\n- **greater:**" },
  { category: "items", id: "electric-eelskin", find: "You cast a 2nd-rank with a .", replace: "You cast a 2nd-rank Thunderstrike with a ." },
  { category: "items", id: "jaathooms-scarf", find: "The scarf casts 4th-rank on you.", replace: "The scarf casts 4th-rank Invisibility on you." },
  { category: "items", id: "shadow-ash", find: "destroys it remains completely such as a spell)", replace: "destroys it remains completely such as a Disintegrate spell)" },
  { category: "items", id: "tears-of-the-last-azlanti", find: "| **Active Power** Cast at will | |", replace: "| **Active Power** Cast Hypercognition at will | |" },
  { category: "feats", id: "all-in-my-head", find: "cause instant death (such as ).", replace: "cause instant death (such as Disintegrate)." },
  { category: "feats", id: "duel-spell-advantage", find: "choose: Confusion, , Suggestion,", replace: "choose: Confusion, Hallucination, Suggestion," },
  { category: "feats", id: "light-bending-jewel", find: "you can cast either or Translocate", replace: "you can cast either Invisibility or Translocate" },
  { category: "feats", id: "thoughtsense", find: "You gain as a vague sense", replace: "You gain Thoughtsense as a vague sense" },
  { category: "classFeatures", id: "monarch-of-the-fey-courts", find: "- **5th**\n- **6th** Dominate", replace: "- **5th** Hallucination\n- **6th** Dominate" },
  { category: "classFeatures", id: "speaker-in-sibilance", find: "- **3rd**\n- **4th** Snake Fangs", replace: "- **3rd** Hypercognition\n- **4th** Snake Fangs" },
  { category: "items", id: "drazmorgs-staff-of-all-sight", find: "- **4th** , Countless Eyes, Detect Scrying", replace: "- **4th** Clairvoyance, Countless Eyes, Detect Scrying" },
  { category: "items", id: "invisibility", find: "gaining the effects of a 2nd-rank spell.", replace: "gaining the effects of a 2nd-rank Invisibility spell." },
  { category: "items", id: "invisibility-greater", find: "gaining the effects of a 2nd-rank spell.", replace: "gaining the effects of a 2nd-rank Invisibility spell." },
  { category: "items", id: "invisibility-potion", find: "you gain the effects of a 2nd-rank spell.", replace: "you gain the effects of a 2nd-rank Invisibility spell." },
  { category: "items", id: "seers-flute-greater", find: "- **3rd** ,", replace: "- **3rd** Clairaudience," },
  { category: "items", id: "seers-flute-greater", find: ", Wanderer's Guide", replace: "Hypercognition, Wanderer's Guide" },
  { category: "items", id: "stage-magicians-cloak", find: "You cast a 2nd-rank on yourself", replace: "You cast a 2nd-rank Invisibility on yourself" },
  { category: "items", id: "wand-of-the-ash-puppet", find: "**Effect** You cast . If the spell reduces", replace: "**Effect** You cast Disintegrate. If the spell reduces" },
  { category: "feats", id: "djinni-magic", find: "You can cast Gust of Wind and once per day each", replace: "You can cast Gust of Wind and Invisibility once per day each" },
  { category: "feats", id: "invisible-trickster", find: "You can cast 4th-rank as a primal innate spell", replace: "You can cast 4th-rank Invisibility as a primal innate spell" },
  { category: "feats", id: "suli-amir", find: "Read Omens and 4th-rank each once per day", replace: "Read Omens and 4th-rank Invisibility each once per day" },
  { category: "classFeatures", id: "impostor-in-hidden-places", find: "\n- **2nd**\n", replace: "\n- **2nd** Invisibility\n" },
  { category: "classFeatures", id: "impostor-in-hidden-places", find: "\n- **8th**\n", replace: "\n- **8th** Disappearance\n" },
  { category: "classFeatures", id: "impostor-in-hidden-places", find: "\n- **9th**\n", replace: "\n- **9th** Phantasmagoria\n" },
  { category: "classFeatures", id: "school-of-protean-form", find: "- **9th:**", replace: "- **9th:** Metamorphosis" },
  { category: "items", id: "crown-of-intellect", find: "You gain the effects of .", replace: "You gain the effects of Hypercognition." },
  { category: "items", id: "ghost-dust", find: "it casts a 4th-rank spell on you", replace: "it casts a 4th-rank Invisibility spell on you" },
  { category: "items", id: "presentable", find: "as though it had just been affected by .", replace: "as though it had just been affected by Prestidigitation." },
  { category: "items", id: "presentable-greater", find: "as though it had just been affected by .", replace: "as though it had just been affected by Prestidigitation." },
  { category: "items", id: "staff-of-the-ruling-beast", find: "- **1st** Command,\n", replace: "- **1st** Command, Ventriloquism\n" },
  { category: "items", id: "vanishing-wayfinder", find: "the effects of a 2nd-rank spell for 5 minutes.", replace: "the effects of a 2nd-rank Invisibility spell for 5 minutes." },
  { category: "feats", id: "dig-up-secrets", find: "You can cast as an innate occult spell once per day.", replace: "You can cast Hypercognition as an innate occult spell once per day." },
  { category: "feats", id: "flames-of-vision", find: "You can cast as a 4th-rank innate occult spell twice per day.", replace: "You can cast Clairvoyance as a 4th-rank innate occult spell twice per day." },
  { category: "feats", id: "reclaimant-plea", find: "Unfettered Movement, , Cleanse Affliction", replace: "Unfettered Movement, Invisibility, Cleanse Affliction" },
  { category: "classFeatures", id: "bloodline-shadow", find: "8th: ; 9th: Weird", replace: "8th: Disappearance; 9th: Weird" },
  { category: "classFeatures", id: "school-of-kalistrade", find: "- **7th:** Project Image,\n", replace: "- **7th:** Project Image, Retrocognition\n" },
  { category: "classFeatures", id: "school-of-kalistrade", find: "- **8th:** , Hidden Mind", replace: "- **8th:** Disappearance, Hidden Mind" },
  { category: "classFeatures", id: "school-of-kalistrade", find: "- **cantrips:** , Read Aura", replace: "- **cantrips:** Prestidigitation, Read Aura" },
  { category: "classFeatures", id: "school-of-kalistrade", find: "- **2nd:** Ghostly Carrier,", replace: "- **2nd:** Ghostly Carrier, Invisibility" },
  { category: "classFeatures", id: "school-of-kalistrade", find: "- **3rd:** , Veil of Privacy", replace: "- **3rd:** Clairaudience, Veil of Privacy" },
  { category: "items", id: "cloak-of-elvenkind-greater", find: "a 4th-rank , with the spell", replace: "a 4th-rank Invisibility, with the spell" },
  { category: "items", id: "gasping-lament", find: "- **2nd** Sonata Span,\n", replace: "- **2nd** Sonata Span, Ventriloquism\n" },
  { category: "items", id: "gasping-lament-greater", find: "- **2nd** Sonata Span,\n", replace: "- **2nd** Sonata Span, Ventriloquism\n" },
  { category: "items", id: "pistol-of-wonder", find: "| 51 | The pistol casts . |", replace: "| 51 | The pistol casts Disintegrate. |" },
  { category: "items", id: "staff-of-phantasms-major", find: "- **6th** , Mislead", replace: "- **6th** Hallucination, Mislead" },
  { category: "items", id: "unifying-emblem-skoan-quah", find: "**Effect** The tattoo casts .", replace: "**Effect** The tattoo casts Ventriloquism." },
  { category: "feats", id: "cantorian-restoration", find: "leaves no remains, such as .", replace: "leaves no remains, such as Disintegrate." },
  { category: "feats", id: "fiendish-magic", find: "False Vitality, , See the Unseen", replace: "False Vitality, Invisibility, See the Unseen" },
  { category: "feats", id: "phantom-orchestra", find: "You can cast 2nd-rank as an innate primal spell", replace: "You can cast 2nd-rank Ventriloquism as an innate primal spell" },
  { category: "classFeatures", id: "reveler-in-lost-glee", find: "- **Cantrip**\n- **1st** Dizzying Colors", replace: "- **Cantrip** Prestidigitation\n- **1st** Dizzying Colors" },
  { category: "classFeatures", id: "the-tangible-dream", find: "- 2nd:\n- 3rd: Sea of Thought", replace: "- 2nd: Invisibility\n- 3rd: Sea of Thought" },
  { category: "items", id: "entertainers-lute-major", find: "- **1st** Bless,\n", replace: "- **1st** Bless, Ventriloquism\n" },
  { category: "items", id: "entertainers-lute-major", find: "- **5th** , Illusory Creature", replace: "- **5th** Hallucination, Illusory Creature" },
  { category: "items", id: "spotless-spats", find: "as if by the spell.", replace: "as if by the Prestidigitation spell." },
  { category: "feats", id: "angelkin", find: "you gain the skill feat.", replace: "you gain the Multilingual skill feat." },
  { category: "feats", id: "expert-skysage-divination", find: "spell repertoire: or Read Omens.", replace: "spell repertoire: Clairvoyance or Read Omens." },
  { category: "feats", id: "living-god", find: "You cast as a 10th-rank occult spell", replace: "You cast Manifestation as a 10th-rank occult spell" },
  { category: "feats", id: "ultimate-mercy", find: "if it died from or a death effect.", replace: "if it died from Disintegrate or a death effect." },
  { category: "classFeatures", id: "echo-of-lost-moments", find: "\n- **7th**\n", replace: "\n- **7th** Retrocognition\n" },
  { category: "classFeatures", id: "school-of-mentalism", find: "- **5th:** , Illusory Scene", replace: "- **5th:** Hallucination, Illusory Scene" },
  { category: "classFeatures", id: "school-of-mentalism", find: "- **8th:** , Uncontrollable Dance", replace: "- **8th:** Disappearance, Uncontrollable Dance" },
  { category: "classFeatures", id: "school-of-mentalism", find: "- **9th:**\n\n**School Spells**", replace: "- **9th:** Phantasmagoria\n\n**School Spells**" },
  { category: "items", id: "conch-of-otherworldly-seas", find: "causing the conch to cast a 5th-rank spell for your benefit", replace: "causing the conch to cast a 5th-rank Clairaudience spell for your benefit" },
  { category: "items", id: "gate-attenuator", find: "**metal**\n\n**water** Snowball", replace: "**metal** Thunderstrike\n\n**water** Snowball" },
  { category: "items", id: "potion-of-undetectability", find: "You also gain the effects of a 4th-rank spell", replace: "You also gain the effects of a 4th-rank Invisibility spell" },
  { category: "items", id: "staff-of-the-magi", find: "- **2nd** Enlarge, Revealing Light, , Knock", replace: "- **2nd** Enlarge, Revealing Light, Invisibility, Knock" },
  { category: "items", id: "staff-of-the-magi", find: "- **4th** , Enlarge, Fireball", replace: "- **4th** Invisibility, Enlarge, Fireball" },
  { category: "items", id: "staff-of-the-magi", find: "- **6th** , Dispel Magic, Fireball", replace: "- **6th** Disintegrate, Dispel Magic, Fireball" },
  { category: "items", id: "vanishing-coin", find: "it casts a 2nd-rank spell on you", replace: "it casts a 2nd-rank Invisibility spell on you" },
  { category: "feats", id: "dazzling-dragonet-disappearance", find: "you become affected by a 4th-rank spell", replace: "you become affected by a 4th-rank Invisibility spell" },
  { category: "feats", id: "first-world-adept", find: "You gain and Revealing Light as 2nd-rank primal innate spells", replace: "You gain Invisibility and Revealing Light as 2nd-rank primal innate spells" },
  { category: "feats", id: "prophet-of-kalistrade-dedication", find: "plus either or Read Aura", replace: "plus either Prestidigitation or Read Aura" },
  { category: "classFeatures", id: "order-of-the-rack", find: "**Lesser Benefit**\n\n**Greater Benefit**", replace: "**Lesser Benefit** Disillusionment\n\n**Greater Benefit**" },
  { category: "classFeatures", id: "swarm-eidolon", find: "your eidolon gains the reaction.", replace: "your eidolon gains the Redistribute reaction." },
  { category: "items", id: "dust-of-disappearance", find: "casts a 4th-rank spell with a duration of 1 minute", replace: "casts a 4th-rank Invisibility spell with a duration of 1 minute" },
  { category: "items", id: "invisible-chain-shirt", find: "*+2 resilient chain shirt*", replace: "*+2 resilient Invisibility chain shirt*" },
  { category: "items", id: "seers-flute-major", find: "- **3rd** , ", replace: "- **3rd** Clairaudience, " },
  { category: "items", id: "seers-flute-major", find: ", Wanderer's Guide", replace: "Hypercognition, Wanderer's Guide" },
  { category: "items", id: "seers-flute-major", find: "**4th** , Object Reading", replace: "**4th** Clairvoyance, Object Reading" },
  { category: "items", id: "starfaring-cloak", find: "is bound by for a century and a day", replace: "is bound by Imprisonment for a century and a day" },
  { category: "items", id: "wondrous-figurine-ruby-hippopotamus", find: "it transforms into an enraged that sees", replace: "it transforms into an enraged Hippopotamus that sees" },
  { category: "feats", id: "dracomancer", find: "(for example, Fear and for a conspirator dragon benefactor)", replace: "(for example, Fear and Invisibility for a conspirator dragon benefactor)" },
  { category: "feats", id: "labyrinthine-echoes", find: "you can cast as an occult innate spell", replace: "you can cast Ventriloquism as an occult innate spell" },
  { category: "feats", id: "this-is-what-its-like-to-die", find: "You gain as an occult innate spell", replace: "You gain Phantasmagoria as an occult innate spell" },
  { category: "classFeatures", id: "lesson-of-memory", find: "your familiar learns .", replace: "your familiar learns Hypercognition." },
  { category: "classFeatures", id: "school-of-thassilonian-rune-magic", find: "- **3rd:** , Veil of Privacy", replace: "- **3rd:** Clairaudience, Veil of Privacy" },
  { category: "classFeatures", id: "school-of-thassilonian-rune-magic", find: "- **4th:** , Fly", replace: "- **4th:** Clairvoyance, Fly" },
  { category: "items", id: "crystal-ball-clear-quartz", find: "The *crystal ball* casts to your specifications.", replace: "The *crystal ball* casts Clairvoyance to your specifications." },
  { category: "items", id: "crystal-ball-moonstone", find: "The *crystal ball* casts to your specifications.", replace: "The *crystal ball* casts Clairvoyance to your specifications." },
  { category: "items", id: "crystal-ball-obsidian", find: "The *crystal ball* casts to your specifications.", replace: "The *crystal ball* casts Clairvoyance to your specifications." },
  { category: "items", id: "crystal-ball-peridot", find: "The *crystal ball* casts to your specifications.", replace: "The *crystal ball* casts Clairvoyance to your specifications." },
  { category: "items", id: "crystal-ball-selenite", find: "The *crystal ball* casts to your specifications.", replace: "The *crystal ball* casts Clairvoyance to your specifications." },
  { category: "items", id: "impenetrable-scale", find: "*greater resilient adamantine scale mail*", replace: "*greater resilient Fortification adamantine scale mail*" },
  { category: "items", id: "ring-of-observation-moderate", find: "The ring can cast on you once per day.", replace: "The ring can cast Invisibility on you once per day." },
  { category: "items", id: "ring-of-observation-greater", find: "The ring can cast either a 2nd- or 4th-rank on you once per day.", replace: "The ring can cast either a 2nd- or 4th-rank Invisibility on you once per day." },
  { category: "items", id: "staff-of-the-tempest", find: "- **1st** Hydraulic Push,", replace: "- **1st** Hydraulic Push, Thunderstrike" },
  { category: "items", id: "staff-of-the-tempest", find: "- **2nd** Mist, Resist Energy (electricity only),", replace: "- **2nd** Mist, Resist Energy (electricity only), Thunderstrike" },
  { category: "items", id: "staff-of-the-tempest-greater", find: "- **1st** Hydraulic Push,", replace: "- **1st** Hydraulic Push, Thunderstrike" },
  { category: "items", id: "staff-of-the-tempest-greater", find: "- **2nd** Mist, Resist Energy (electricity only),", replace: "- **2nd** Mist, Resist Energy (electricity only), Thunderstrike" },
  { category: "items", id: "staff-of-the-tempest-major", find: "- **1st** Hydraulic Push,", replace: "- **1st** Hydraulic Push, Thunderstrike" },
  { category: "items", id: "staff-of-the-tempest-major", find: "- **2nd** Mist, Resist Energy (electricity only),", replace: "- **2nd** Mist, Resist Energy (electricity only), Thunderstrike" },
  { category: "items", id: "ventriloquists-ring", find: "with the effects of a spell ().", replace: "with the effects of a Ventriloquism spell ()." },
  { category: "items", id: "ventriloquists-ring-greater", find: "with the effects of a 2nd-rank spell ().", replace: "with the effects of a 2nd-rank Ventriloquism spell ()." },
  { category: "feats", id: "dimensional-disappearance", find: "you're affected by an spell at the end of the teleport.", replace: "you're affected by an Invisibility spell at the end of the teleport." },
  { category: "feats", id: "gnome-polyglot", find: "When you select the feat,", replace: "When you select the Multilingual feat," },
  { category: "feats", id: "ruby-resurrection", find: "if you were killed by you wouldn't return.", replace: "if you were killed by Disintegrate you wouldn't return." },
  { category: "classFeatures", id: "bloodline-genie", find: "- **Jaathoom** 2nd: ; 5th: Illusory Scene", replace: "- **Jaathoom** 2nd: Invisibility; 5th: Illusory Scene" },
  { category: "classFeatures", id: "school-of-civic-wizardry", find: "- **cantrips:** , Read Aura", replace: "- **cantrips:** Prestidigitation, Read Aura" },
  { category: "classFeatures", id: "school-of-civic-wizardry", find: "- **6th:** , Wall of Force", replace: "- **6th:** Disintegrate, Wall of Force" },
  { category: "classFeatures", id: "school-of-civic-wizardry", find: "- **7th:** Planar Palace,\n", replace: "- **7th:** Planar Palace, Retrocognition\n" },
  { category: "items", id: "autumns-embrace", find: "When activating the armor's property rune", replace: "When activating the armor's Invisibility property rune" },
  { category: "items", id: "flame-navette", find: "the benefit of the fighter's class feat", replace: "the benefit of the fighter's Determination class feat" },
  { category: "items", id: "staff-of-arcane-might-greater", find: "- **6th** , Mystic Armor, Wall of Force", replace: "- **6th** Disintegrate, Mystic Armor, Wall of Force" },
  { category: "items", id: "staff-of-arcane-might-major", find: "- **6th** , Mystic Armor, Wall of Force", replace: "- **6th** Disintegrate, Mystic Armor, Wall of Force" },
  { category: "items", id: "tricksters-mandolin", find: "- **Cantrip**\n- **1st**", replace: "- **Cantrip** Prestidigitation\n- **1st**" },
  { category: "items", id: "tricksters-mandolin", find: "Illusory Disguise, Item Facade,\n\n---", replace: "Illusory Disguise, Item Facade, Ventriloquism\n\n---" },
  { category: "feats", id: "arcane-shroud", find: "Fleet Step, Flicker, , Mountain Resilience", replace: "Fleet Step, Flicker, Invisibility, Mountain Resilience" },
  { category: "feats", id: "fey-cantrips", find: "the draxie heritage, you gain .", replace: "the draxie heritage, you gain Prestidigitation." },
  { category: "feats", id: "natural-illusionist", find: "Illusory Disguise, Item Facade, or .", replace: "Illusory Disguise, Item Facade, or Ventriloquism." },
  { category: "classFeatures", id: "bloodline-demonic", find: "6th: ; 7th: Divine Decree", replace: "6th: Disintegrate; 7th: Divine Decree" },
  { category: "classFeatures", id: "school-of-battle-magic", find: "- **6th:** Chain Lightning,\n", replace: "- **6th:** Chain Lightning, Disintegrate\n" },
  { category: "items", id: "assassins-bracers-type-i", find: "You cast 4th-rank on yourself", replace: "You cast 4th-rank Invisibility on yourself" },
  { category: "items", id: "mentalists-staff-major", find: "- **3rd** Phantom Pain\n", replace: "- **3rd** Hypercognition Phantom Pain\n" },
  { category: "items", id: "mentalists-staff-major", find: "- **5th** Phantom Pain Synaptic Pulse", replace: "- **5th** Hallucination Phantom Pain Synaptic Pulse" },
  { category: "items", id: "spy-staff-greater", find: "- **3rd** , Illusory Disguise, Veil of Privacy", replace: "- **3rd** Clairaudience, Illusory Disguise, Veil of Privacy" },
  { category: "items", id: "spy-staff-greater", find: "- **4th** , Peaceful Bubble", replace: "- **4th** Clairvoyance, Peaceful Bubble" },
  { category: "classFeatures", id: "bloodline-harrow", find: "; 7th: ; 8th: Unrelenting Observation", replace: "; 7th: Retrocognition; 8th: Unrelenting Observation" },
  { category: "items", id: "branch-attendants-mask", find: "- **Uzunjati**", replace: "- **Uzunjati** Prestidigitation" },
  { category: "items", id: "fossil-fragment-brontosaurus-phalange", find: "This massive toe bone becomes a when activated.", replace: "This massive toe bone becomes a Brontosaurus when activated." },
  { category: "items", id: "staff-of-elemental-power", find: "- **1st** Breathe Fire, Pummeling Rubble,\n", replace: "- **1st** Breathe Fire, Pummeling Rubble, Thunderstrike\n" },
  { category: "items", id: "staff-of-elemental-power-greater", find: "- **1st** Breathe Fire, Pummeling Rubble,\n", replace: "- **1st** Breathe Fire, Pummeling Rubble, Thunderstrike\n" },
  { category: "items", id: "staff-of-elemental-power-major", find: "- **1st** Breathe Fire, Pummeling Rubble,\n", replace: "- **1st** Breathe Fire, Pummeling Rubble, Thunderstrike\n" },
  { category: "items", id: "tricksters-mandolin-greater", find: "- **Cantrip**\n", replace: "- **Cantrip** Prestidigitation\n" },
  { category: "items", id: "tricksters-mandolin-greater", find: "- **1st** Illusory Disguise, Item Facade,\n", replace: "- **1st** Illusory Disguise, Item Facade, Ventriloquism\n" },
  { category: "items", id: "tricksters-mandolin-greater", find: "- **2nd** Blur, Illusory Creature, Illusory Disguise,\n", replace: "- **2nd** Blur, Illusory Creature, Illusory Disguise, Invisibility\n" },
  { category: "feats", id: "armor-rune-shifter", find: "Energy-Resistant, , Raiment", replace: "Energy-Resistant, Fortification, Raiment" },
  { category: "feats", id: "armor-rune-shifter", find: ", , Shadow, Slick.", replace: ", Invisibility, Shadow, Slick." },
  { category: "feats", id: "fey-magic", find: "You can cast Faerie Fire and each once per day", replace: "You can cast Faerie Fire and Invisibility each once per day" },
  { category: "feats", id: "perfect-protection", find: "If your armor has a rune, you roll only one flat check", replace: "If your armor has a Fortification rune, you roll only one flat check" },
  { category: "classFeatures", id: "bloodline-phoenix", find: "6th: ; 7th: Contingency", replace: "6th: Disintegrate; 7th: Contingency" },
  { category: "items", id: "fossil-fragment-tyrannosaur-tooth", find: "This dagger-shaped tooth turns into a when activated.", replace: "This dagger-shaped tooth turns into a Tyrannosaurus when activated." },
  { category: "items", id: "osteomancers-pouch", find: "the dice cast for you.", replace: "the dice cast Clairvoyance for you." },
  { category: "items", id: "staff-of-impossible-visions-true", find: "- **9th** Unfathomable Song,", replace: "- **9th** Unfathomable Song, Phantasmagoria" },
  { category: "items", id: "tricksters-mandolin-major", find: "- **Cantrip**", replace: "- **Cantrip** Prestidigitation" },
  { category: "items", id: "tricksters-mandolin-major", find: "- **1st** Illusory Disguise, Item Facade,", replace: "- **1st** Illusory Disguise, Item Facade, Ventriloquism" },
  { category: "items", id: "tricksters-mandolin-major", find: "- **2nd** Blur, Illusory Creature, Illusory Disguise,", replace: "- **2nd** Blur, Illusory Creature, Illusory Disguise, Invisibility" },
  { category: "items", id: "tricksters-mandolin-major", find: "- **4th** Confusion, , Illusory Disguise", replace: "- **4th** Confusion, Invisibility, Illusory Disguise" },
  { category: "items", id: "tricksters-mandolin-major", find: "- **5th** , Illusory Scene, Illusory Disguise", replace: "- **5th** Hallucination, Illusory Scene, Illusory Disguise" },
  { category: "feats", id: "avoid-fates-gaze", find: "(such as or", replace: "(such as Clairaudience or" },
  { category: "feats", id: "avoid-fates-gaze", find: " ) treat you as if", replace: " Clairvoyance) treat you as if" },
  { category: "feats", id: "feys-trickery", find: "This has the effects of .", replace: "This has the effects of Invisibility." },
  { category: "feats", id: "perfected-gamtu", find: "your choice of 2nd-rank or 6th-rank *invisibility*.", replace: "your choice of 2nd-rank Invisibility or 6th-rank *invisibility*." },
  { category: "spells", id: "summon-elemental-herald", find: "dealing 10d6 damage and 3d6 damage to all enemies in a with a basic Reflex save", replace: "dealing 10d6 fire damage and 3d6 persistent fire damage to all enemies in a 60-foot emanation with a basic Reflex save" },
  { category: "spells", id: "summon-elemental-herald", find: "dealing 4d8 damage and 4d12 damage to all enemies in a with a basic Reflex save", replace: "dealing 4d8 slashing damage and 4d12 electricity damage to all enemies in a 50-foot emanation with a basic Reflex save" },
  { category: "spells", id: "summon-elemental-herald", find: "dealing 6d8 damage to all enemies in a with a basic Fortitude save", replace: "dealing 6d8 bludgeoning damage to all enemies in a 120-foot cone with a basic Fortitude save" },
  { category: "spells", id: "summon-elemental-herald", find: "dealing 6d10 damage to each enemy in a with a basic Reflex save", replace: "dealing 6d10 piercing damage to each enemy in a 50-foot emanation with a basic Reflex save" },
  { category: "items", id: "explosive-missive", find: "to each creature in a from a corner of the missive's space ().", replace: "to each creature in a 5-foot burst from a corner of the missive's space (DC 18 basic Reflex save)." },
  { category: "items", id: "glimmering-missive", find: "multicolored motes in a from a corner", replace: "multicolored motes in a 10-foot burst from a corner" },
  { category: "items", id: "illusory-backdrop", find: "The illusion then emanates in a from the center of the line", replace: "The illusion then emanates in a 15-foot cone from the center of the line" },
  { category: "items", id: "incense-of-distilled-death", find: "whereupon it fills a with oily smoke", replace: "whereupon it fills a 10-foot emanation with oily smoke" },
  { category: "items", id: "lacquered-waist-drum", find: "generates a pulse of energy in a from you", replace: "generates a pulse of energy in a 30-foot emanation from you" },
  { category: "items", id: "paradigm-cube", find: "the illusion created fills a from you and lasts", replace: "the illusion created fills a 60-foot emanation from you and lasts" },
  { category: "items", id: "screech-shooter", find: "All creatures in a from you must attempt a save.", replace: "All creatures in a 30-foot emanation from you must attempt a DC 25 Will save." },
  { category: "items", id: "singing-shortbow", find: "This affects every creature in a from the creature you hit.", replace: "This affects every creature in a 10-foot emanation from the creature you hit." },
  { category: "items", id: "singing-shortbow-greater", find: "This affects every creature in a from the creature you hit.", replace: "This affects every creature in a 10-foot emanation from the creature you hit." },
  { category: "items", id: "sphere-of-annihilation", find: "to everything in a from the point of their destruction.", replace: "to everything in a 60-foot burst from the point of their destruction." },
  { category: "items", id: "wyrm-spindle", find: "deals 6d6 damage to all creatures in a with a save.", replace: "deals 6d6 damage to all creatures in a 30-foot cone with a DC 28 basic Reflex save." },
  { category: "spells", id: "final-fate-of-the-locust-host", find: "to enemy creatures in a with a basic Reflex save.", replace: "to enemy creatures in a 60-foot emanation with a basic Reflex save." },
  { category: "spells", id: "garden-of-the-green-mans-growth", find: "dealing 10d8 damage to creatures in a with a basic Reflex save.", replace: "dealing 10d8 bludgeoning damage to creatures in a 60-foot emanation with a basic Reflex save." },
  { category: "spells", id: "holy-host", find: "dealing damage to all creatures in a with a save.", replace: "dealing 8d6 spirit damage to all creatures in a 20-foot emanation with a basic Fortitude save." },
  { category: "spells", id: "instant-minefield", find: "and every creature in a from the mine", replace: "and every creature in a 5-foot emanation from the mine" },
  { category: "spells", id: "nature-incarnate", find: "must succeed at a against your spell DC", replace: "must succeed at a Fortitude save against your spell DC" },
  { category: "classFeatures", id: "energetic-meltdown", find: "to all creatures in a with a save.", replace: "to all creatures in a 30-foot emanation with a basic Fortitude save." },
  { category: "familiarAbilities", id: "purify-air", find: "creatures within a from the leshy", replace: "creatures within a 15-foot emanation from the leshy" },
  { category: "feats", id: "zombie-horde", find: "companions within a from its original space", replace: "companions within a 30-foot emanation from its original space" },
  { category: "conditions", id: "stupefied", find: "you succeed at a with a DC equal to", replace: "you succeed at a flat check with a DC equal to" },
  { category: "feats", id: "draconic-acolyte-dedication", find: "Choose a with a trait that matches", replace: "Choose a draconic benefactor with a trait that matches" },
  { category: "feats", id: "nanite-surge", find: "lighting a with dim light", replace: "lighting a 10-foot emanation with dim light" },
  { category: "feats", id: "radiant-burst", find: "must succeed at a against your class DC", replace: "must succeed at a Fortitude save against your class DC" },
  { category: "feats", id: "topple-the-titans", find: "emitting a quake in a from their space", replace: "emitting a quake in a 10-foot emanation from their space" },
  { category: "items", id: "boulder-seed", find: "the bomb fills a with hardened foam", replace: "the bomb fills a 5-foot cube with hardened foam" },
  { category: "items", id: "boulder-seed-greater", find: "the bomb fills a with hardened foam", replace: "the bomb fills a 5-foot cube with hardened foam" },
  { category: "items", id: "camp-shroud-minor", find: "enshrouds everything in a from the fire", replace: "enshrouds everything in a 10-foot emanation from the fire" },
  { category: "items", id: "camp-shroud-lesser", find: "enshrouds everything in a from the fire", replace: "enshrouds everything in a 15-foot emanation from the fire" },
  { category: "items", id: "camp-shroud-lesser", find: "attempt a DC 18 Perception check", replace: "attempt a DC 23 Perception check" },
  { category: "items", id: "camp-shroud-moderate", find: "enshrouds everything in a from the fire", replace: "enshrouds everything in a 20-foot emanation from the fire" },
  { category: "items", id: "camp-shroud-moderate", find: "attempt a DC 18 Perception check", replace: "attempt a DC 27 Perception check" },
  { category: "items", id: "camp-shroud-greater", find: "enshrouds everything in a from the fire", replace: "enshrouds everything in a 25-foot emanation from the fire" },
  { category: "items", id: "camp-shroud-greater", find: "attempt a DC 18 Perception check", replace: "attempt a DC 30 Perception check" },
  { category: "items", id: "camp-shroud-major", find: "enshrouds everything in a from the fire", replace: "enshrouds everything in a 30-foot emanation from the fire" },
  { category: "items", id: "camp-shroud-major", find: "attempt a DC 18 Perception check", replace: "attempt a DC 35 Perception check" },
  { category: "items", id: "explosive-mine-lesser", find: "dealing damage to any creatures in a with a save.", replace: "dealing the listed fire damage to any creatures in a 5-foot emanation with a basic Reflex save." },
  { category: "items", id: "explosive-mine-moderate", find: "dealing damage to any creatures in a with a save.", replace: "dealing the listed fire damage to any creatures in a 5-foot emanation with a basic Reflex save." },
  { category: "items", id: "explosive-mine-greater", find: "dealing damage to any creatures in a with a save.", replace: "dealing the listed fire damage to any creatures in a 5-foot emanation with a basic Reflex save." },
  { category: "items", id: "explosive-mine-major", find: "dealing damage to any creatures in a with a save.", replace: "dealing the listed fire damage to any creatures in a 10-foot emanation with a basic Reflex save." },
  { category: "feats", id: "barrier-shield", find: "you can use for , but not for blocking", replace: "you can use for cover, but not for blocking" },
  { category: "feats", id: "beacon-mark", find: "the creature can attempt a saving throw against your spell DC", replace: "the creature can attempt a Will saving throw against your spell DC" },
  { category: "items", id: "madcap-top", find: "| 11 | affects you. |", replace: "| 11 | Invisibility affects you. |" },
  { category: "items", id: "cantrip-deck-full-pack", find: "- Message\n-\n- Ignition", replace: "- Message\n- Prestidigitation\n- Ignition" },
  { category: "items", id: "thresholds-of-truth", find: "- Telekinetic Hand\n- Light\n-\n- Read Aura", replace: "- Telekinetic Hand\n- Light\n- Prestidigitation\n- Read Aura" },
  { category: "items", id: "thresholds-of-truth", find: "4th Level\n\n-\n- Daydreamer's Curse", replace: "4th Level\n\n- Clairvoyance\n- Daydreamer's Curse" },
  { category: "items", id: "mentalists-staff-greater", find: "- **3rd** Phantom Pain", replace: "- **3rd** Hypercognition, Phantom Pain" },
  { category: "items", id: "mentalists-staff-greater", find: "- **1st** Mindlink Phantom Pain", replace: "- **1st** Mindlink, Phantom Pain" },
  { category: "classFeatures", id: "ashes", find: "Mist (takes the form of ash)\n- **6th:**\n\n**Revelation Spells**\n\n- **initial:**", replace: "Mist (takes the form of ash)\n- **6th:** Disintegrate\n\n**Revelation Spells**\n\n- **initial:**" },
  { category: "classFeatures", id: "bloodline-elemental", find: "**Metal—Sorcerous Gifts** cantrip Electric Arc; 1st: ; 3rd: Lightning Bolt; 6th: Chain Lightning;", replace: "**Metal—Sorcerous Gifts** cantrip Electric Arc; 1st: Thunderstrike; 3rd: Lightning Bolt; 6th: Chain Lightning;" },
  { category: "classFeatures", id: "bloodline-imperial", find: "4th: Translocate, 5th: Scouting Eye, 6th: , 7th: , 8th: Quandary, 9th: Implosion\n\n**Bloodline", replace: "4th: Translocate, 5th: Scouting Eye, 6th: Disintegrate, 7th: Retrocognition, 8th: Quandary, 9th: Implosion\n\n**Bloodline" },
  { category: "classFeatures", id: "way-of-the-vanguard", find: "Fortification; *Advanced* Spinning Crush; *Greater*\n\n**Way Skill** Athletics", replace: "Fortification; *Advanced* Spinning Crush; *Greater* Siegebreaker\n\n**Way Skill** Athletics" },
  { category: "items", id: "open-mind", find: "your inner eye; you gain the effects of .", replace: "your inner eye; you gain the effects of Hypercognition." },
  { category: "items", id: "razmiri-mask-porcelain", find: "reality to bend to your will. You cast as a 10th-rank occult spell, but no matter", replace: "reality to bend to your will. You cast Manifestation as a 10th-rank occult spell, but no matter" },
  { category: "items", id: "whispering-staff", find: "**3rd** Darkvision, Mind Reading\n- **4th** , Detect Scrying, Telepathy\n- **5th**", replace: "**3rd** Darkvision, Mind Reading\n- **4th** Clairvoyance, Detect Scrying, Telepathy\n- **5th**" },
  { category: "classFeatures", id: "bloodline-fey", find: "Fit, 3rd: Enthrall, 4th: Suggestion, 5th: , 6th: Mislead, 7th: Visions of Danger, 8th: Uncontrollable Dance, 9th:\n\n**Bloodline Spells** initial: Faerie", replace: "Fit, 3rd: Enthrall, 4th: Suggestion, 5th: Hallucination, 6th: Mislead, 7th: Visions of Danger, 8th: Uncontrollable Dance, 9th: Metamorphosis\n\n**Bloodline Spells** initial: Faerie" },
  { category: "classFeatures", id: "bloodline-hag", find: "Metamorphosis, 7th: Warp Mind, 8th: Quandary, 9th:\n\n**Bloodline Spells** initial: Jealous", replace: "Metamorphosis, 7th: Warp Mind, 8th: Quandary, 9th: Phantasmagoria\n\n**Bloodline Spells** initial: Jealous" },
  { category: "classFeatures", id: "emerald-boughs", find: "Scrying\n- **7th:** True Target\n- **8th:**\n- **9th:** Foresight", replace: "Scrying\n- **7th:** True Target\n- **8th:** Disappearance\n- **9th:** Foresight" },
  { category: "classFeatures", id: "envy", find: "**cantrips:** Shield, Tangle Vine\n- **1st:** , Enfeeble\n- **2nd:** Dispel Magic, Stupefy", replace: "**cantrips:** Shield, Tangle Vine\n- **1st:** Schadenfreude, Enfeeble\n- **2nd:** Dispel Magic, Stupefy" },
  { category: "classFeatures", id: "gluttony", find: "**5th:** Corrosive Muck, Slither\n- **6th:** , Vampiric Exsanguination\n- **7th:** Devouring", replace: "**5th:** Corrosive Muck, Slither\n- **6th:** Disintegrate, Vampiric Exsanguination\n- **7th:** Devouring" },
  { category: "classFeatures", id: "greed", find: "- **8th:** Monstrosity Form\n- **9th:**\n\n**Initial School Spell** Precious Gleam", replace: "- **8th:** Monstrosity Form\n- **9th:** Metamorphosis\n\n**Initial School Spell** Precious Gleam" },
  { category: "classFeatures", id: "pride", find: "Disguise\n- **2nd:** Illusory Creature,\n- **3rd:** Blindness, Levitate", replace: "Disguise\n- **2nd:** Illusory Creature, Invisibility\n- **3rd:** Blindness, Levitate" },
  { category: "classFeatures", id: "wrath", find: "Frostbite, Ignition\n- **1st:** Force Barrage,\n- **2nd:** Blistering Invective, Floating", replace: "Frostbite, Ignition\n- **1st:** Force Barrage, Thunderstrike\n- **2nd:** Blistering Invective, Floating" },
  { category: "classFeatures", id: "wrath", find: "Blizzard, Wall of Ice\n- **6th:** Blinding Fury,\n- **7th:** Eclipse Burst, Fiery Body", replace: "Blizzard, Wall of Ice\n- **6th:** Blinding Fury, Disintegrate\n- **7th:** Eclipse Burst, Fiery Body" },
  { category: "classFeatures", id: "uzunjati", find: "**cantrips:** Daze\n- **1st:** Mindlink,\n- **2nd:** Kgalaserke's Axes\n- **3rd:** Ibex's Harvest\n- **4th:** Telepathy\n- **5th:** Mind Probe, Truespeech\n- **6th:** Mislead\n- **7th:**\n- **8th:** Hidden Mind\n- **9th:**", replace: "**cantrips:** Daze\n- **1st:** Mindlink, Ventriloquism\n- **2nd:** Kgalaserke's Axes\n- **3rd:** Ibex's Harvest\n- **4th:** Telepathy\n- **5th:** Mind Probe, Truespeech\n- **6th:** Mislead\n- **7th:** Retrocognition\n- **8th:** Hidden Mind\n- **9th:** Phantasmagoria" },
  { category: "classFeatures", id: "rain-scribes", find: "Palace\n- **8th:** Earthquake\n- **9th:**", replace: "Palace\n- **8th:** Earthquake\n- **9th:** Metamorphosis" },
  /* ---- residue pass (2026-08-27): 42 names the 12-15-char ID heuristic ate (F5-F8), plus the
   * damaged-description sweep. Each transcribed from the mirror (or, for gamtu-hat, from the
   * conjuring feat feat-6828 — the item has no equipment page of its own). */
  { category: "spells", id: "mislead", find: "*mislead*'s invisibility, just like a 4th-rank spell. A creature that determines the", replace: "*mislead*'s invisibility, just like a 4th-rank Invisibility spell. A creature that determines the" },
  { category: "spells", id: "scrying", find: "creature of your choice. *Scrying* works like , except that the image you receive is", replace: "creature of your choice. *Scrying* works like Clairvoyance, except that the image you receive is" },
  { category: "spells", id: "wall-of-force", find: "the wall is automatically destroyed by a spell of any rank.", replace: "the wall is automatically destroyed by a Disintegrate spell of any rank." },
  { category: "spells", id: "freedom", find: "from all such effects, even effects like that don't have a duration, as long as", replace: "from all such effects, even effects like Imprisonment that don't have a duration, as long as" },
  { category: "spells", id: "detect-metal", find: "detect metal hidden by illusions (such as ) only if the illusion has a lower rank", replace: "detect metal hidden by illusions (such as Invisibility) only if the illusion has a lower rank" },
  { category: "spells", id: "revival", find: "*Revival* can't resurrect creatures killed by or a death effect. It has no effect on", replace: "*Revival* can't resurrect creatures killed by Disintegrate or a death effect. It has no effect on" },
  { category: "spells", id: "remake", find: "(even a speck of dust that remains from is enough). The spell fails if your imagination", replace: "(even a speck of dust that remains from Disintegrate is enough). The spell fails if your imagination" },
  { category: "spells", id: "breath-of-life", find: "effect that leaves no remains, such as\n\n---\n\n**Heightened (+2)** The healing", replace: "effect that leaves no remains, such as Disintegrate\n\n---\n\n**Heightened (+2)** The healing" },
  { category: "spells", id: "chromatic-wall", find: "to anyone passing through, with a save. can counteract a *yellow chromatic wall*.", replace: "to anyone passing through, with a save. Disintegrate can counteract a *yellow chromatic wall*." },
  { category: "spells", id: "ode-to-ouroboros", find: "increasing its dying condition, such as and death effects.", replace: "increasing its dying condition, such as Disintegrate and death effects." },
  { category: "spells", id: "invisibility-cloak", find: "with the same restrictions as the 2nd-rank spell.\n\n---\n\n**Heightened (6th)** The", replace: "with the same restrictions as the 2nd-rank Invisibility spell.\n\n---\n\n**Heightened (6th)** The" },
  { category: "spells", id: "shroud-of-the-mantis", find: "with the same restrictions as a 2nd-rank spell.\n\n---\n\n**Heightened (6th)** The", replace: "with the same restrictions as a 2nd-rank Invisibility spell.\n\n---\n\n**Heightened (6th)** The" },
  { category: "spells", id: "spirit-veil", find: "senses they have; this grants the effects of , but against all the undead creature's", replace: "senses they have; this grants the effects of Invisibility, but against all the undead creature's" },
  { category: "spells", id: "burglars-blind", find: "perfect mix, affecting them with both the and Silence spells. If the target takes", replace: "perfect mix, affecting them with both the Invisibility and Silence spells. If the target takes" },
  { category: "spells", id: "rune-of-observation", find: "eye-shaped rune in the air, creating a sensor as . When created, this eye must be in your", replace: "eye-shaped rune in the air, creating a sensor as Clairvoyance. When created, this eye must be in your" },
  { category: "spells", id: "imprint-message", find: "for. If the object is in the area of a spell, the imprinted messages appear as", replace: "for. If the object is in the area of a Retrocognition spell, the imprinted messages appear as" },
  { category: "spells", id: "dinosaur-fort", find: "four quadrants of the fort is guarded by a . While the tyrannosauruses won't cross", replace: "four quadrants of the fort is guarded by a Tyrannosaurus. While the tyrannosauruses won't cross" },
  { category: "spells", id: "shock-to-the-system", find: "Speed). In addition, it can cast 5th-rank as an innate spell at will, using your", replace: "Speed). In addition, it can cast 5th-rank Thunderstrike as an innate spell at will, using your" },
  { category: "actions", id: "seek", find: "imprecise sense or if an effect (such as ) prevents the subject from being observed.", replace: "imprecise sense or if an effect (such as Invisibility) prevents the subject from being observed." },
  { category: "actions", id: "adopt-persona", find: "2nd-rank Illusory Disguise and 2nd-rank on you. The duration of both effects is", replace: "2nd-rank Illusory Disguise and 2nd-rank Ventriloquism on you. The duration of both effects is" },
  { category: "actions", id: "nudging-whisper", find: "is to Lie, you gain the effects of the feat. If you critically fail at either", replace: "is to Lie, you gain the effects of the Confabulator feat. If you critically fail at either" },
  { category: "heritages", id: "polyglot-android", find: "your other languages. If you select the feat, you learn three new languages instead", replace: "your other languages. If you select the Multilingual feat, you learn three new languages instead" },
  { category: "heritages", id: "nomadic-halfling", find: "available to you, and every time you take the feat, you gain another new language.", replace: "available to you, and every time you take the Multilingual feat, you gain another new language." },
  { category: "deities", id: "the-curtain-call", find: "associated with this pantheon are Arshea, Bolka, , Nocticula, and Shelyn.\n\n**Areas of Concern**", replace: "associated with this pantheon are Arshea, Bolka, Findeladlara, Nocticula, and Shelyn.\n\n**Areas of Concern**" },
  { category: "backgrounds", id: "lost-loved-one", find: "the Genealogy Lore skill. You gain the skill feat.", replace: "the Genealogy Lore skill. You gain the Multilingual skill feat." },
  { category: "backgrounds", id: "sleepless-suns-star", find: "residents of the Foreign Quarter. You gain the skill feat.", replace: "residents of the Foreign Quarter. You gain the Multilingual skill feat." },
  { category: "backgrounds", id: "brevic-noble", find: "the Mercantile Lore skill. You gain the skill feat.\n\n**Lodovka**", replace: "the Mercantile Lore skill. You gain the Multilingual skill feat.\n\n**Lodovka**" },
  { category: "backgrounds", id: "runelord-scholar", find: "and the Academia Lore skill. You gain the skill feat, but one of the languages you", replace: "and the Academia Lore skill. You gain the Multilingual skill feat, but one of the languages you" },
  { category: "backgrounds", id: "student-of-the-ancients", find: "and the Azlanti Lore skill. You gain the skill feat; one language gained must be", replace: "and the Azlanti Lore skill. You gain the Multilingual skill feat; one language gained must be" },
  { category: "backgrounds", id: "clan-associate", find: "and the Highhelm Lore skill. You gain the skill feat.\n\n**Connection:**", replace: "and the Highhelm Lore skill. You gain the Multilingual skill feat.\n\n**Connection:**" },
  { category: "backgrounds", id: "bookish-providence", find: "is a free attribute boost.\n\nYou gain the skill feat, are trained in the Academia", replace: "is a free attribute boost.\n\nYou gain the Multilingual skill feat, are trained in the Academia" },
  { category: "backgrounds", id: "belkzen-anthropologist", find: "gods both current and past. You gain the skill feat.", replace: "gods both current and past. You gain the Multilingual skill feat." },
  { category: "backgrounds", id: "emissary", find: "city you've visited often. You gain the skill feat.", replace: "city you've visited often. You gain the Multilingual skill feat." },
  { category: "backgrounds", id: "hermean-heritor", find: "and the Legal Lore skill. You gain the skill feat or the Assurance skill feat", replace: "and the Legal Lore skill. You gain the Multilingual skill feat or the Assurance skill feat" },
  { category: "backgrounds", id: "kyonin-emissary", find: "and the Politics Lore skill. You gain the skill feat.", replace: "and the Politics Lore skill. You gain the Multilingual skill feat." },
  { category: "backgrounds", id: "onyx-trader", find: "the Mercantile Lore skill. You gain the skill feat.", replace: "the Mercantile Lore skill. You gain the Multilingual skill feat." },
  { category: "backgrounds", id: "printer", find: "and the Scribing Lore skill. You gain the skill feat.", replace: "and the Scribing Lore skill. You gain the Multilingual skill feat." },
  { category: "backgrounds", id: "translator", find: "and the Scribing Lore skill. You gain the skill feat.", replace: "and the Scribing Lore skill. You gain the Multilingual skill feat." },
  { category: "backgrounds", id: "verduran-city-folk", find: "and the Games Lore skill. You gain either or Streetwise as a skill feat.", replace: "and the Games Lore skill. You gain either Multilingual or Streetwise as a skill feat." },
  { category: "backgrounds", id: "local-savior", find: "constant threat. Choose either Daze or as your divine innate cantrip. Turtleback", replace: "constant threat. Choose either Daze or Prestidigitation as your divine innate cantrip. Turtleback" },
  { category: "items", id: "gamtu-hat", find: "hat and gain the effects of a 2nd-rank spell, which lasts for the spell's normal", replace: "hat and gain the effects of a 2nd-rank Invisibility spell, which lasts for the spell's normal" },
  {
    /* The DC the whole resonant power hangs on — "always succeed at the DC 6 flat check" — was
     * dropped by the cleaner, leaving a grammatical sentence with the number missing. Wording from
     * the AoN mirror (Paizo/ORC), never from WG. ⚠ After this lands, re-run
     * `node scripts/backfill-aeon-resonance.mjs --write` then `node scripts/apply-backfill-now.mjs`:
     * the derived `resonant` overlay row reads its note out of this description, so repairing the
     * prose without re-deriving leaves the resonant.note still damaged. */
    category: 'items', id: 'aeon-stone-agate-ellipsoid',
    find: 'always succeed at the to give an answer other than',
    replace: 'always succeed at the DC 6 flat check to give an answer other than',
  },
  {
    /* Emanation, both damage expressions AND the save were dropped — the necromancer horde's whole
     * attack read as a rule with no numbers. From the mirror. */
    category: 'actions', id: 'mobbing-assault',
    find: 'Each enemy in a around your horde takes damage (if your horde is zombies) or damage (if your horde is skeletons) with a save against your spell DC.',
    replace: 'Each enemy in a 5-foot emanation around your horde takes 2d6 bludgeoning damage (if your horde is zombies) or 2d6 slashing damage (if your horde is skeletons) with a basic Reflex save against your spell DC.',
  },
  {
    /* "roll a ." — the DC 15 flat check the whole feat turns on. From the mirror. */
    category: 'feats', id: 'inexorable',
    find: 'roll a . On a success you ignore the condition.',
    replace: 'roll a DC 15 flat check. On a success you ignore the condition.',
  },
  {
    /* The spell NAME was dropped ("gain the effects of , with the spell"). From the mirror. */
    category: 'items', id: 'cloak-of-illusions',
    find: 'gain the effects of , with the spell',
    replace: 'gain the effects of Invisibility, with the spell',
  },
  {
    category: 'items', id: 'cloak-of-illusions-greater',
    find: 'gain the effects of a 4th-rank , with the spell',
    replace: 'gain the effects of a 4th-rank Invisibility, with the spell',
  },
  {
    /* The emanation size was dropped, leaving "within a gain a +10-foot status bonus". From the
     * mirror (equipment-3937). ⚠ items/fife-of-the-faithful carries the same corruption — separate
     * finding, verify its exact string before adding it here. */
    category: 'items', id: 'guangu-of-the-steppe',
    find: 'within a gain a +10-foot status bonus',
    replace: 'within a 60-foot emanation gain a +10-foot status bonus',
  },
  {
    /* Both "60-foot emanation" phrases were dropped at import, leaving "within a gain 15" and
     * "within a 5". From the AoN mirror (equipment-3927). Two rows apply in sequence; the overlay
     * row the second writes supersedes the first, leaving one durable description row. */
    category: 'items', id: 'blakenshipper',
    find: 'allies within a gain 15 temporary Hit Points',
    replace: 'allies within a 60-foot emanation gain 15 temporary Hit Points',
  },
  {
    category: 'items', id: 'blakenshipper',
    find: 'allies within a 5 temporary Hit Points',
    replace: 'allies within a 60-foot emanation 5 temporary Hit Points',
  },
  {
    category: 'items', id: 'brazier-of-harmony',
    find: 'smoke surrounds the censer in a , creating a space of peace and harmony.',
    replace: 'smoke surrounds the censer in a 20-foot emanation, creating a space of peace and harmony.',
  },
  {
    category: 'items', id: 'bellows-pipes',
    find: 'You and all allies within a gain a +1 status bonus',
    replace: 'You and all allies within a 15-foot emanation gain a +1 status bonus',
  },
  {
    category: 'items', id: 'aeon-stone-crescent',
    find: 'in a , dealing 4d12 damage to all creatures in the area ( save).',
    replace: 'in a 100-foot line, dealing 4d12 spirit damage to all creatures in the area (DC 22 basic Reflex save).',
  },
  {
    /* The third cantrip's NAME was dropped — "…, and ." From the mirror. */
    category: 'items', id: 'ring-of-minor-arcana',
    find: 'Telekinetic Hand, and .',
    replace: 'Telekinetic Hand, and Prestidigitation.',
  },
  {
    /* The emanation size was dropped. From the mirror (equipment-3771-3572). */
    category: 'items', id: 'trudds-strength',
    find: 'Protective energy releases in a , granting',
    replace: 'Protective energy releases in a 10-foot emanation, granting',
  },
  {
    /* The cleaner dropped the damage type, the cone AND the save DC — four grades, same wound.
     * From the mirror. */
    category: 'items', id: 'crackling-bubble-gum-lesser',
    find: 'The pop deals 4d4 to all creatures in a with a save.',
    replace: 'The pop deals 4d4 sonic damage to all creatures in a 15-foot cone with a DC 19 basic Fortitude save.',
  },
  {
    category: 'items', id: 'crackling-bubble-gum-moderate',
    find: 'The pop deals 6d4 to all creatures in a with a save.',
    replace: 'The pop deals 6d4 sonic damage to all creatures in a 15-foot cone with a DC 25 basic Fortitude save.',
  },
  {
    category: 'items', id: 'crackling-bubble-gum-greater',
    find: 'The pop deals 8d4 to all creatures in a with a save.',
    replace: 'The pop deals 8d4 sonic damage to all creatures in a 15-foot cone with a DC 30 basic Fortitude save.',
  },
  {
    category: 'items', id: 'crackling-bubble-gum-major',
    find: 'The pop deals 9d4 to all creatures in a with a save.',
    replace: 'The pop deals 9d4 sonic damage to all creatures in a 15-foot cone with a DC 34 basic Fortitude save.',
  },
  {
    /* The emanation size was dropped, leaving "within a gain a +1 status bonus". From the mirror. */
    category: 'items', id: 'warpipes',
    find: 'within a gain a +1 status bonus',
    replace: 'within a 60-foot emanation gain a +1 status bonus',
  },
  {
    /* The damage TYPE was dropped — "persistent bleed" — leaving a grammatical sentence that reads
     * as ordinary damage. Wording from the AoN mirror (Paizo/ORC). The variant record
     * greater-killers-belt is already correct and must NOT be touched. */
    category: 'items', id: 'killers-belt',
    find: 'The target takes 1d6 damage.',
    replace: 'The target takes 1d6 persistent bleed damage.',
  },
  {
    category: 'items', id: 'killers-belt-greater',
    find: 'The target takes 2d6 damage.',
    replace: 'The target takes 2d6 persistent bleed damage.',
  },
  {
    category: 'feats', id: 'aerial-boomerang',
    find: 'races away from you in a . Each creature in the area takes damage with a save against your class DC.',
    replace: 'races away from you in a 60-foot line. Each creature in the area takes 2d4 slashing damage with a basic Reflex save against your class DC.',
  },
  {
    category: 'feats', id: 'breath-of-the-dragon-dragonblood',
    find: 'energy in a or a , dealing 1d4 damage.',
    replace: 'energy in a 15-foot cone or a 30-foot line, dealing 1d4 damage.',
  },
  {
    category: 'feats', id: 'battle-medicine',
    find: 'The target is then to your Battle Medicine for 1 day.',
    replace: 'The target is then immune to your Battle Medicine for 1 day.',
  },
  {
    category: 'actions', id: 'treat-wounds',
    find: 'The target is then temporarily to Treat Wounds actions for 1 hour,',
    replace: 'The target is then temporarily immune to Treat Wounds actions for 1 hour,',
  },
  // ---- wg-batch-019 (ancestries + backgrounds read): stat lines the import dropped or that print
  // ---- differently — each adversarially confirmed against the mirror (work/.b019-findings.json).
  { category: 'ancestries', id: 'azarketi', find: '**Speed** 20 feet\n\n', replace: '**Speed** 20 feet, swim 30 feet\n\n' },
  { category: 'ancestries', id: 'merfolk', find: '**Speed** 5 feet\n\n', replace: '**Speed** 5 feet, swim 25 feet\n\n' },
  { category: 'ancestries', id: 'athamaru', find: '**Speed** 20 feet\n\n', replace: '**Speed** 20 feet, swim 25 feet\n\n' },
  { category: 'ancestries', id: 'kashrishi', find: '**Languages** Common\n\n', replace: '**Languages** Common, Kashrishi\n\n' },
  { category: 'ancestries', id: 'skeleton', find: '**Senses** Normal', replace: '**Senses** Low Light Vision' },
  { category: 'ancestries', id: 'automaton', find: '**Size** Medium\n\n', replace: '**Size** Medium or Small\n\n' },
  { category: 'ancestries', id: 'fleshwarp', find: '**Size** Medium\n\n', replace: '**Size** Medium or Small\n\n' },
  { category: 'ancestries', id: 'awakened-animal', find: '**Size** Medium\n\n', replace: '**Size** Tiny, Small, Medium, or Large\n\n' },
  { category: 'ancestries', id: 'awakened-animal', find: '**Hit Points** 6\n\n', replace: '**Hit Points** 6 (Tiny/Small), 8 (Medium), or 10 (Large)\n\n' },
  { category: 'actions', id: 'envenom', find: '**Frequency** once per day\n\n---\n\n', replace: '**Frequency** once per day; **Saving Throw** Fortitude\n\n---\n\n' },
  // ---- wg-batch-020 (backgrounds read): the record's data trains Athletics (correct per print);
  // ---- the description said Acrobatics twice (work/.b020-findings.json).
  { category: 'backgrounds', id: 'second-chance-champion', find: "You're trained in Acrobatics and the Gladia", replace: "You're trained in Athletics and the Gladia" },
  { category: 'backgrounds', id: 'second-chance-champion', find: '**Trained Skill** Acrobatics', replace: '**Trained Skill** Athletics' },
  // The one World Guide background whose printed Region prerequisite the import dropped.
  { category: 'backgrounds', id: 'shory-seeker', find: "You've dedicated your life to unraveling the secrets", replace: "**Prerequisite** Region - Mwangi Expanse\n\n---\n\nYou've dedicated your life to unraveling the secrets" },
  // ---- wg-batch-022: the record prints "Theater Lore" (US spelling); the details line said Theatre.
  { category: 'backgrounds', id: 'entertainer', find: '**Lore** Theatre Lore', replace: '**Lore** Theater Lore' },
  // ---- wg-batch-023: the @Check template was deleted whole, leaving "must attempt a ." — the
  // record's entire mechanic is that DC 3 flat check (the dropped-inline-values class).
  { category: 'backgrounds', id: 'anti-magical', find: 'the originator of the effect must attempt a .', replace: 'the originator of the effect must attempt a DC 3 flat check.' },
];

const DESC_PATH = 'public/core-descriptions.json';
const desc = JSON.parse(readFileSync(join(root, DESC_PATH), 'utf8'));

const applied = [];
for (const r of REPAIRS) {
  const cur = desc[r.category]?.[r.id]?.d;
  if (typeof cur !== 'string') fail(`${r.category}/${r.id} has no description to repair`);
  if (cur.includes(r.replace)) { console.log(`  = ${r.category}/${r.id} already repaired`); applied.push({ ...r, text: cur }); continue; }
  const n = cur.split(r.find).length - 1;
  if (n !== 1) fail(`${r.category}/${r.id}: the damaged phrase occurs ${n} times, expected exactly 1 — re-anchor before writing`);
  const next = cur.split(r.find).join(r.replace);
  desc[r.category][r.id].d = next;
  applied.push({ ...r, text: next });
  console.log(`  ✓ ${r.category}/${r.id}`);
}

/* The overlay row carries the WHOLE repaired description, not a diff, because that is the only shape
 * `applyBackfill` understands (`target[field] = value`) and the only thing that survives a regen. */
const rows = readBackfill(root);
let added = 0, refreshed = 0;
for (const a of applied) {
  const i = rows.findIndex((x) => x.category === a.category && x.id === a.id && x.field === 'description' && !x.path);
  const row = { category: a.category, id: a.id, field: 'description', value: a.text };
  if (i >= 0) { rows[i] = row; refreshed++; } else { rows.push(row); added++; }
}

if (DRY) { console.log(`\n--dry: ${added} rows would be added, ${refreshed} refreshed; nothing written`); process.exit(0); }
writeFileSync(join(root, DESC_PATH), JSON.stringify(desc));
writeBackfill(root, rows);
console.log(`\noverlay: ${added} added, ${refreshed} refreshed (now ${rows.length} rows)`);
console.log(`written: ${DESC_PATH}, scripts/data/effect-backfill.json`);
