# What the Archives do NOT have

You asked me to tell you when I cannot find something rather than quietly leave the old value in.
Nine agents searched every remaining field. This is the complete list of what they could not find,
with the searches they ran, so you can check any of it against your app.

**Almost nothing is genuinely missing.** Most of what previous passes called "absent" turned out to be
a page we were not reading, a link we were not following, or a record joined to the wrong document.

---

## deities

Nothing in these four fields is missing for any deity that has an archive page. All four are printed on the page AND carried as structured arrays, and the arrays are lossless against their markdown twins across all 717 docs.

Three HH deity records have no archive deity document at all. Here is exactly what I searched.

1. ALOCER (HH source: Pathfinder One-Shot #2: Dinner at Lionlodge; domains might/nature/pain/zeal, font harm, weapon shortbow, skill survival).
   - aon.db `SELECT ... WHERE name LIKE '%Alocer%'` over all 43,686 docs -> 2 hits, both the creature "Megaloceros" (creature-1776, creature-2202).
   - Full-JSON scan `WHERE json LIKE '%Alocer%'` -> 3 docs: those two plus creature-family-301 "Elk". No deity doc anywhere contains the string.
   - `WHERE category='deity' AND (json LIKE '%Lionlodge%' OR json LIKE '%One-Shot%')` -> 0 docs.
   - Field-shape search over all 717 deity docs for domains {Might, Nature, Pain, Zeal} -> 1 hit, deity-499 Urazra, whose font/weapon/skill are Harm / Spiked Gauntlet / Athletics. Not a match; I am not proposing it.

2. THE CURTAIN CALL (HH source: Pathfinder Curtain Call Player's Guide; domains creation/family/indulgence/passion, font heal, weapon sword-cane, skill performance).
   - `WHERE name LIKE '%Curtain Call%'` -> 3 hits: equipment-1782 "Curtain Call Cloak", its item-bonus twin, and source-244 "Curtain Call Player's Guide". The book IS indexed.
   - `WHERE category='deity' AND json LIKE '%Curtain Call%'` -> 0 docs. `WHERE category='deity' AND json LIKE '%Sources.aspx?ID=244%'` -> 0 docs. The Archives index the source but publish no deity from it.
   - Field-shape search for domains {Creation, Family, Indulgence, Passion} across all 717 deity docs -> 0 hits. Search for skill Performance + font exactly [Heal] -> 3 hits (Bes, Hathor, Atreia), none of which is it.

3. ATHEISTS AND FREE AGENTS.
   - `WHERE json LIKE '%Atheists and Free Agents%'` -> 0 of 43,686 docs. `WHERE name LIKE '%Atheist%'` -> 0 docs.
   - The only atheism records are deity-21 (legacy) and deity-297 (remaster), both named "Atheism", and HH already pairs its `aon-atheism` record to deity-297. "Atheists and Free Agents" is a section heading in Divine Mysteries, not a deity. NOTHING IS NEEDED HERE: HH's record already carries empty domains, empty divineFont, empty favoredWeapons and no skill, and the Archives agree there is nothing to carry.

RECOVERED — one deity previously written off is NOT absent.
MIGRATION.md lists `Norns` among the records "genuinely absent from AoN". It is not. It is deity-322 "Followers of Fate" (Divine Mysteries Web Supplement, legacy twin deity-210 in Bestiary 2). The page states the identity in its own words: "some mortals worship norns as deities ... Those who uphold norns as deities are known as Followers of Fate." Its four fields — Harm|Heal, Shears, Occultism, Family/Fate/Knowledge/Truth — are byte-identical to HH's `norns` record. Pairing it takes deity coverage from 481 to 482 of 485. Heroes Heaven names the deities, the Archives name the covenant, which is the same naming habit already documented for implements and orders.

TWO RECORDS NEED YOUR EYE (not absent, but the Archives say two different things).
Gozreh and Arshea. Their REMASTER pages (deity-284, deity-465) print `**[Alternate Domains]**` with nothing after it, and the field is absent. Their LEGACY pages carry values: deity-8 Gozreh ["Cold","Lightning"], deity-113 Arshea ["Change","Family","Protection"] — which is exactly what Heroes Heaven holds today. These are the only 2 of 484 non-superseded deity docs where the legacy twin has alternate domains and the remaster page does not. Either Divine Mysteries dropped them or the AoN page is blank. I have NOT changed them — the transform stays silent and HH keeps its values. Powder Punch Stance is the precedent: a corpus majority is not evidence about a specific record, so this is your call, not mine.

ONE MORE FOR YOUR DECISION — Lissala. The remastered page (deity-565) prints only THREE Domains (Fate, Magic, Toil) plus one Alternate (Glyph). Heroes Heaven holds four (fate, glyph, magic, toil) and the Splinter Faith rule needs four. `data.domain`, the Archives' own combined field, gives exactly those four, so the never-shrink fallback is still Archives-sourced — but the printed Domains line really does say three.

---

## backgrounds

No FIELD is missing from the Archives. Two individual RECORDS are, and one HH value is simply pointed at the wrong archive page. Here is exactly what I searched, so you can check me.

1) Belkzen Anthropologist — the skill feat. HH has grantedFeatId "multilingual". The Archives state no feat for it.
   - Export doc background-516, `data.markdown`, in full after the source block: "You're trained in the [Society](/Skills.aspx?ID=47) skill, and the [Orc Pantheon Lore](/Skills.aspx?ID=41) skill, a broad skill pertaining to orc gods both current and past." That is the last sentence on the page. No "feat", no /Feats.aspx link anywhere in the body.
   - `data.feat` = null and `data.feat_markdown` = null (both keys are absent from the doc entirely — I dumped the key list: it has skill/skill_markdown but no feat/feat_markdown).
   - aon.db, read-only: `select id,category,name from docs where json like '%Belkzen Anthropologist%'` → exactly 1 row, ('background-516','background','Belkzen Anthropologist'). No sidebar, rules page, archetype or errata doc mentions it.
   - The whole doc JSON contains the string "feat" once (in "is_standard_ancestry_feat"), i.e. never as content.
   - `select id,name from docs where category='background' and json like '%Triumph of the Tusk Player%'` → 6 backgrounds (Badlands Scout, Belkzen Anthropologist, Empty Hand Loyalist, Foreign Diplomat, Self-Made, Trade Representative); the other five all print their feat, this one does not.
   - `select ... where json like '%Orc Pantheon Lore%'` → 3 rows (feat-7647 Tattooed Historian Dedication, background-516, archetype-313), none of which grants a feat to this background.
   Conclusion: AoN's page for this background is missing the skill feat line. Everything else on the record is reproduced.

2) Streetfood Vendor — the Society option. HH has trainedSkillChoice ["crafting","society"]. The Archives print Crafting only.
   - Export doc background-479, full clause: "You're trained in the [Crafting](/Skills.aspx?ID=37) skill, and the [Cooking Lore](/skills/lore) skill. You gain the [Seasoned](/Feats.aspx?ID=5210) skill feat." No "or", no second skill.
   - `data.skill` = ["Crafting","Cooking Lore"] — AoN's own facet agrees with its prose.
   - aon.db: `select ... where json like '%Streetfood Vendor%'` → exactly 1 row (background-479). No legacy/remaster twin (`superseded_by` and `supersedes` are both null).
   - The string "Society" appears 0 times anywhere in that doc's JSON.
   Conclusion: the Society option is not in the Archives. It is either a Foundry addition or a printing HH picked up elsewhere; your call which wins.

3) NOT absent, but the archive contradicts itself — please rule on these two. In each case AoN's structured facet and AoN's own printed prose give different answers, and I chose the prose.
   - background-352 Almas Clerk: prose "You gain the [Glean Contents](/Feats.aspx?ID=2129) skill feat"; facet `data.feat` = ["Crafter's Appraisal"], `data.feat_markdown` = "[Crafter's Appraisal](/Feats.aspx?ID=2118)". HH says glean-contents and test/identity-data.test.ts:61 pins it, so the prose is right and the facet is wrong.
   - background-356 Gold Falls Regular: prose "You're trained in the [Performance](/Skills.aspx?ID=12) skill, as well as your choice of the [Cooking Lore] skill or [Volcano Lore] skill. You gain the [Impressive Performance](/Feats.aspx?ID=793) skill feat"; facet `data.skill` = ["Acrobatics"], `data.feat` = null. HH says acrobatics, agreeing with the facet. This is the ONE record where my transform disagrees with HH on a skill and I cannot settle it from the Archives alone — both answers are in the Archives, on the same page. aon.db has exactly one Gold Falls Regular doc, so there is no twin to prefer.

4) NOT absent — a JOIN defect on HH's side. `refugee-fall-of-plaguestone` (trainedSkill survival / trainedLore hunting / grantedFeatId forager) carries aonId "background-455", which is the Player Core 2 Refugee (Society / a settlement Lore / Streetwise). The Fall of Plaguestone Refugee IS in the Archives, as background-40, named "Refugee (FoP)", book "The Fall of Plaguestone", skill ["Survival","Hunting Lore"], feat ["Forager"] — an exact match for HH's values, and used-docs.json already maps `refugee-fop -> background-40`. Two HH records (`refugee-fall-of-plaguestone`, `refugee-pc2`) both point at background-455; run backgroundFacets on background-40 for the first and the mismatch disappears. Two other archive docs are likewise double-claimed: background-392 (historical-reenactor + aon-historical-reeanactor) and background-314 (reclaimer-investigator + aon-reclaimed-investigator). used-docs.json is also stale against core.json — it holds 7 slugs core.json no longer has (refugee-fop, post-guard-of-all-trade, reclaimed-investigator, muesellos-student, historical-reeanactor, refugee, wishes-for-riches).

5) THE ARCHIVES ANSWER AN EXISTING dataWarning. verduran-city-folk carries "The printed choice is between Streetwise and one other skill feat, whose name is missing from this data source." The Archives print it: background-505, "You gain either [Multilingual](/Feats.aspx?ID=5181) or [Streetwise](/Feats.aspx?ID=5218) as a skill feat." The missing name is Multilingual. That dataWarning and the test pinning it can both be deleted.

---

## spells-block

Three values, all `duration`, are genuinely not printed anywhere in the Archives for their record. Everything else in this domain was found.

1. rite-of-the-red-star — HH duration "10 minutes". Doc ritual-71. Searched: `data.duration_raw` (undefined), `data.duration` (undefined), top-level `duration_s` (undefined), the `**Duration**` stat row (the page has Cast / Secondary Casters / Primary Check / Secondary Checks / Range / Target(s) and no Duration row at all), the whole of `data.markdown` for /minutes?/ (0 hits) and for /Duration/ (0 hits), and the legacy/remaster chain (`data.legacy_id`, `data.remaster_id`, `supersedes`, `superseded_by` — all undefined, so there is no twin page to fall back to). The page's degree-of-success block describes the portal but never states how long it stays open.

2. forgotten-lines — HH duration "varies". Doc spell-550. Searched: `data.duration_raw` (undefined), `data.duration` (undefined), the `**Duration**` row (absent — the stat block is Source / Traditions / Cast / Range / Target and nothing else), the string "Duration" anywhere in `data.markdown` (0 hits), and the legacy chain (`legacy_id` / `supersedes` undefined). The spell reads information off a text and has no duration; HH's "varies" looks like a Foundry placeholder rather than a value the Archives lost.

3. fear-the-sun — HH duration "varies". Doc spell-2350. Searched: `data.duration_raw` (undefined), the `**Duration**` row (absent), and the legacy twin spell-1080 named by `data.legacy_id` — which also has `duration_raw: undefined` and no Duration row. The Archives DO state the per-outcome durations in the body ("**Success** The creature is dazzled for 1 round." / "**Failure** The creature is dazzled for 1 minute." / "**Critical Failure** … light blindness for 1 minute."), so "varies" is derivable from the page STRUCTURE — no Duration row plus per-degree durations — but it is never printed as a duration. Two other spells behave the same way and ARE recovered because their legacy twin prints it: agitate (spell-2341 has no Duration row; its twin spell-566 prints "varies").

Two things that look like gaps and are NOT — reported so they are not mistaken for absence later:

* `targets` on 16 records: the value is on the page, under a different LABEL. On 8 of them the Archives print it as the AREA (dread-ambience "1 square mile", encroaching-woods, footholds-and-foothills, swarming-wasp-stings, natures-reprisal, telekinetic-rend, and bane/bless whose HH "enemies in the area"/"you and allies in the area" restates their printed 10-foot and 15-foot emanations). On 3 it is the TRIGGER, word-for-word — split-the-tongue's HH target IS spell-835's `data.trigger` "A creature within 30 feet fails a Deception or Diplomacy check."; also shaken-confidence and unblinking-flame-emblem. The remaining 5 (split-shadow, biting-words, nettleskin, consecrate-flesh, cordyceps-command) have no Target row because the target is the caster or is named only in the description — nettleskin and consecrate-flesh are HH's only two `targets: "self"` records and their bodies say "Thorns sprout from your body". This is a Foundry-vs-AoN modelling difference, not missing data.

* the fixed-level `target` STRING inside `heightening` (94 of 180 levels): the Archives print the sentence on every one of them, but HH's stored string is a REWRITE, not a quotation. days-weight's 6th-rank entry reads "You can target up to 10 creatures." and HH stores "10 living creatures" — HH substitutes the new count into the BASE target line and pluralises. The transform implements exactly that and reproduces most of them, but HH is internally inconsistent about the "up to" prefix (binding-muzzle keeps it and capitalises it, "Up to 5 creatures"; distracting-chatter drops it; movanic-glimmer keeps the sentence's trailing full stop, "up to 5 animals."). No rule reproduces all three. The Archives have the fact; HH's exact string is a Foundry authoring artefact.

---

## item-uses

Nothing in this domain is missing from the Archives. Every field has a printed source and I have quoted it above. There are two smaller, precise gaps, and neither is an absence of data:

1. 127 records in this domain have NO paired archive doc, so the transform cannot answer for them
   (92 of them carry consumableType/uses, 36 carry counters, one carries both). This is a PAIRING
   gap in scripts/migration/out/used-docs.json, not a data gap. I checked by searching the names of
   all 43,686 exported docs, and 69 of the 127 are on a page that exists under a sibling name —
   HH has expanded one AoN page into per-energy or per-creature records of its own:
     - HH `potion-of-acid-resistance-greater` (and 20 more resistance/retaliation rows).
       The Archives have `equipment-2951-2819` "Potion of Resistance (Lesser)" etc.; the energy
       type is a row INSIDE the page, not part of the title.
     - HH `black-dragons-breath-potion-adult` (and 11 more). The Archives have `equipment-185-226`
       "Dragon's Breath Potion (Adult)"; the dragon type is a row inside.
     - HH `enhanced-hearing-aids` vs `equipment-1349` "Enhanced Hearing Aid" (plural vs singular).
     - HH `busine-of-divine-reinforcements` vs `equipment-1566` "Busine of Divine Reinforcement".
     - HH `eye-of-the-moonwarden` vs `equipment-3673` "Eyes of the Moonwarden".
     - HH `windlass-bola` vs `equipment-1873` "Windlass Bolas"; `tyrants-writs` vs `equipment-1801`
       "Tyrant's Writ"; `astrolabe-of-the-falling-stars` vs `equipment-2412`.
   These are recoverable with an idMap entry each — the frequency and dose data is on those pages.

2. 58 of the 127 return nothing from a name search over all 43,686 docs. Exact search: I built the
   normalised name of every doc in the export (lowercased, punctuation stripped, markdown links
   unwrapped) and required every content word of the HH name to appear, then re-ran it with the
   energy/dragon/grade words dropped. Still nothing for:
     Basic Ingredient, Special Ingredient, Belimarius's Invidious Halberd, Cinnamon Nostalgia Bun,
     Conductor's Instrument, Darkening Poison, Dream Hunter's Lodge, Effortless Garden, Fate
     Tempter's Ring, Formulated Sunlight, Hagbane Biscuit, Hallajin Key, Holy Steam Ball Refill,
     Incense Bundle of Annual Blessings, Light Writer Plates, Magical Medal (Gorilla's Might /
     Phoenix's Fire / Unicorn's Purity), Makeshift Staff, Mindmurk Oil, One/Three/Ten Day's Breath,
     Poison Sedum, Runic Skullcap, Sakura's Sprig, Seven-Color Raw Fish Salad, Shrine Inarizushi,
     Sling Darts, Sorshen's Scintillating Garment, Sorshen's Sinuous Guisarme, Spider Mold, Spindle
     Key, Spray Pellets, Stony Hag Eye, Submersible Helmet, Suit of Armoire, Taljjae's Mask (The
     General / The Hero / The Nobleman), The Kardosian Fragments, Timeflaying Blade, Tteokguk of
     Time Advancement, Wasul Reed Mask, Witch Token, and the ten Scroll of Nth-rank Spell rows.
   The last ten are HH's own generic spell-slot templates (`item.spellSlot`) with no AoN counterpart
   by design. The rest read like adventure-path or HH-authored gear; the Archives may well carry
   them under a name I did not guess, and if you can tell me the AoN page for even one of them I
   will re-check the whole list. I am NOT claiming the Archives lack them — only that a full-corpus
   name search did not find them.

One thing I could NOT source and did not ship, stated plainly: 135 records keep an existing counter
that no printed line, no prose sentence and no rule supports. They are concentrated in three
groups — 24 aeon-stone variants whose section describes a resonant power with no limit at all, the
wayfinders, and HH's hand-named pools (holy-prayer-beads' bless/heal, brooch-of-shielding's 30
missiles, red-thread-knot's 6 knots). For the last group the Archives DO print the mechanics; what
they don't print is HH's per-activation NAMING, which is an editorial choice HH owns. I checked the
one general rule that might have covered the aeon stones — rules-2232 "Innate Spells" says an item's
innate spell is castable "usually once per day" and innate cantrips at will — and measured it: it
resolves exactly ONE record (Crown of the Master), because every other candidate either prints a
Frequency or says "at will". Shipping it would be a guess dressed as a rule, so I left it out.

---

## item-stats

Nine things in this domain the Archives genuinely do not state, each with the exact search I ran. Everything else in the domain was found.

1. `apexAttribute` for the six mythic artifact items — `anima-robe-heroic`, `fiendbreaker-heroic`, `guiding-star-orb-heroic`, `slithermaws-bane-heroic`, `soulcutter-heroic`, `wintershot-heroic`.
   These are NOT joined to the right doc: HH points them at `equipment-3697…3702` (the non-mythic form), and the mythic form is a separate document — SQL `select id,category,name from docs where name like '%Soulcutter%'` on the full 43,686-doc aon.db returns `equipment-3701 Soulcutter` AND `equipment-3754 Soulcutter (Artifact)`, and the same twin exists for all six. The (Artifact) docs DO carry the `Apex` trait. But scanning the complete JSON of `equipment-3750…3755` for `increase (?:your|its) (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s*(?:score|modif\w*)?\s*by\s*\d` returns nothing on all six, and a scan for the six attribute names anywhere in those documents' JSON returns only the intelligent-item `**Int** +7, **Wis** +6, **Cha** +5` line, which is the item's own mental statistics, not the boost it grants. So: fix the join to `equipment-375x` (that is worth doing regardless — it also fixes their traits and level), but the attribute itself is not on the page. Which attribute does the Spore War heroic-legacy upgrade boost?

2. `apexAttribute` for `viridian-crown` (equipment-3760). The page carries the `Apex` trait and states "**Charisma or Wisdom**" — a player's choice of two. HH stores `'cha'`. Under this app's standing rule never to auto-fill a player's choice, the transform declines rather than picking one. Should the record hold both, or is `cha` a deliberate HH decision?

3. `apexAttribute` for `razmiri-mask-porcelain` (equipment-3593). Full-document scan: the doc carries no `Apex` trait, no "increase your <attribute>" sentence, and no attribute name anywhere in its 4,183-character JSON. HH says `cha`.
   (`sorshens-scintillating-garment` has no archive doc at all — `select … where name like '%Scintillating Garment%'` over all 43,686 docs returns zero rows. It is the same class as the records MIGRATION.md already lists as absent.)

4. `hp` for the ancestry `awakened-animal` (HH says 6). `ancestry-72` prints `<title level="3">Hit Points</title>` followed immediately by `<title level="3">Size</title>` — the row is EMPTY, and so is Speed. It is the only one of the 50 ancestries where this is true; the other 49 all carry `data.hp`. I also checked the two other Awakened Animal documents — `trait-787` and `feat-5297` — and neither contains the string "Hit Points". Where does AoN state an awakened animal's ancestry HP?

5. `hp` / `hardness` / `brokenThreshold` for the vehicle `magic-broom` (HH 20 / 6 / 10). HH joins it to `equipment-251` Broom of Flying, which is an ITEM page, not a vehicle stat block: a substring test for "ardness" and for `\bHP\b` over that document's entire JSON returns false for both. `select … where name like '%Broom of Flying%'` returns exactly one document. AoN has no vehicle stat block for the broom.

6. `hp` / `hardness` / `brokenThreshold` for five vehicles with no archive document. Exact-name SQL over all 43,686 docs: `Flying Carpet` → 0 rows, `Magic Carpet` → 0 rows, `Sandsailer` → 0 rows, `Warship` → 0 rows, `Second Kiss` → 1 row but it is `hazard-172 Second Kiss Engine`, not a vehicle. (MIGRATION.md already records Magic Carpet, Sandsailer and Warship as verified absent; this confirms it for the durability fields too.) `bone-ship` joins to `creature-4838`, a creature stat block, not a vehicle — HH's 415/0/207 has no vehicle-page source.

7. `hp` for `construct-companion` (HH 10). It has no archive doc in `used-docs.json` or `map.json` and MIGRATION.md already lists it among the 963. I went further: `rules-1600 Construct Companions` is the rules page, and its full markdown (1,092 characters) contains no "Hit Points" and no "HP". The 16 other documents matching "Construct Companion" are feats and riding rules. Is a construct companion's HP printed under the Construct Innovation instead?

8. `material.grade` for 39 of the 71 records that carry a material. The material NAME is on the item's page every time (65/71 exact, 0 wrong), but the grade word is printed on only 32 pages. `equipment-517` Radiant Lance is the clean example: its body says "_+2 greater striking holy flaming silver lance_" with no grade word, it has no Craft Requirements line, and no `low-/standard-/high-grade` string appears anywhere in the document. I tried deriving the grade from the item's level against the material page's own per-grade item levels; it reproduces neither HH's value nor a consistent rule (Eclipse is level 8 cold iron and HH says low; Radiant Lance is level 15 silver and HH says standard), so I did not ship a guess. Is the grade something the Archives state elsewhere, or is it a Foundry-only value we should stop carrying?

9. `capacity` in BULK for six containers whose pages state a capacity in another unit. `equipment-1209` Gunner's Bandolier "can hold up to 4 one-handed crossbows…", `equipment-1210` Immaculate Holsters, `equipment-1211` Lucky Draw Bandolier (both grades) — capacity as a count of specific weapons; `equipment-2195` Planar Tunnel — "6 feet across … and 10 feet deep"; `equipment-2384` Mother Maw — "functions as a _portable hole_", also dimensional. HH's `{bulk: 0}` is a faithful encoding of "no Bulk capacity", so nothing is lost, but the Archives do not state a Bulk number and the transform declines rather than inventing one.

---

## ancestries-heritages

Three things, stated precisely. Only (B) is a real absence.

A) heritage → ancestry IS NOT A FIELD ANYWHERE — but it is fully recoverable, so MIGRATION.md:873 should be corrected.
That line currently reads "Known genuine gaps, already verified — do NOT re-derive: heritage→ancestry linkage (the Archives cannot answer it either…)". The first half is true; the conclusion is not. What I searched:
 - All 436 heritage docs, complete key census. Top level: id, category, name, url, rarity, book, release_date, edition, superseded_by/supersedes, exclude_from_search, has_art, pfs, sfs, doc_type, traits, data, ast. `data`: category, exclude_from_search, is_standard_ancestry_feat, id, markdown, name, pfs, primary_source(+_raw/_category/_group), rarity(+_id), release_date, remaster_id, resistance, search_markdown, skill_mod, source(+_raw/_category/_group/_markdown), speed, summary(+_markdown), text, trait(+_group/_raw/_markdown), type, url, weakness, legacy_id, legacy_name, remaster_name. No key names an ancestry. Heritage docs have no `navigation` and no parent pointer.
 - aon.db, all 50 tables from sqlite_master read. No relation table exists: `select count(*) from variants v join docs d on d.id=v.parent_id where d.category in ('ancestry','heritage')` → 0. `source_appearances` holds only creature 3121 / feat 596 / hazard 455 / spell 207 / archetype 44 — no heritage or ancestry rows. `pages` holds 4 rows (Player's Guide, GM Screen, Rules Index, Pathfinder Society).
 - `links`: only 16 ancestry→heritage and 16 heritage→ancestry rows, and they are prose mentions that are actively WRONG for this purpose — `heritage-41` Runtboss Hobgoblin → `ancestry-4` Goblin, `heritage-114` Impersonator Android → `ancestry-6` Human, `heritage-190` Toy Poppet → Centaur. Using them scores 143 right / 16 wrong.
 - The ancestry page itself: no ancestry doc's `data.markdown` links a heritage. `data.navigation` on `ancestry-59` is `[{Details,/Ancestries.aspx?ID=59},{Feats,…/feats},{Heritages,/Ancestries.aspx?ID=59/heritages}]` — a tab URL with no content behind it anywhere in the export or the db.
 - The four category pages that could have listed them are intro prose only, no listing: `category-page-7` and `category-page-100` "Heritages" (528 chars each), `category-page-55`/`-140` "Versatile Heritages" (793/524), `category-page-65` "Half-Human Heritages" (383).
 - I read `Archives of GuyB/app/src-tauri/src/db.rs:2046` and confirm the app really does `SELECT id FROM docs WHERE category='heritage' AND name LIKE '%'||?1||'%'`.
CONCLUSION: no field, but four printed signals answer it for 329 of 331 with zero wrong answers — better than the Archives' own app (257). Not a gap.

B) GENUINELY ABSENT — 3 Beginner Box heritages. `ambitious-human`, `battle-trained-human-bb`, `warden-human-bb`. (MIGRATION.md records 2; `ambitious-human` has no `aonId` either, so it is 3.)
Searches run: `select id,category,name,book from docs where name like '%Ambitious%'` → 0 rows; `… like '%Battle-Trained%'` → 0; `… like '%Warden Human%'` → 0. FTS `docs_fts match '"Ambitious Human"'` → 4 hits, all of them the prose phrase "diverse and ambitious humans" in rules-118, rules-2074, category-page-6, category-page-99 — no heritage. `docs_fts match '"Battle-Trained Human"'` → 0; `'"Warden Human"'` → 0. `select count(*) from docs where category='heritage' and (book like '%Beginner%' or book like '%Unlit%')` → 0. The Archives' entire Beginner Box footprint is: Hero's Handbook 2 backgrounds + 2 source docs; GM's Guide 14 equipment + 3 actions + 2 source; Secrets of the Unlit Star GM's Guide 3 actions + 2 equipment + 1 source. Zero heritages, zero ancestries. Same shape as the adventure-path content you already chose to drop; it needs your decision, and I have taken nothing from Foundry.

C) NOT ABSENT — a PAIRING defect on 2 records, with the correct doc identified.
 - `aon-ganzi` is paired to `trait-339`, a trait page. The real page is `ancestry-32` "Ganzi", `doc_type: "Versatile Heritage"`, `exclude_from_search=0`. There is also `heritage-129` "Ganzi" but it has `exclude_from_search=1`, which is why the importer's hidden-twin guard (the one that lost Knockdown and envision) skipped past it to the trait.
 - `naari` is paired to `trait-870`. Full-corpus search `select id,category,name,book from docs where lower(json) like '%naari%'` returns 10 rows and NOT ONE is an ancestry or heritage page: creature-759 Ifrit Pyrochemist, creature-4507 Naari Pyrochemist, creature-family-595 Geniekin, creature-2633 Lava Otter, equipment-2608 (+4 variants) Scalding Gauntlets, trait-870 Naari ("Naaris are planar scions descended from efreet"). The reason is that Naari is Monster Core 2's REMASTER NAME for Ifrit — `creature-4507` carries `supersedes: creature-759` — and Paizo has not reprinted the heritage page, so the Naari versatile heritage IS `ancestry-33` "Ifrit". This is the Aiuvarin/Half-Elf pattern again, and HH carries both records for the same heritage just as it does for half-elf.
Re-point those two and all six heritage fields reach 331/331.

Nothing else in this domain is missing. Every other field, for every other record, is printed on the page.

---

## classes

Two things are genuinely absent from the Archives. Everything else in this domain is present.

**1. The Magus and Summoner class DC — verified absent, four ways.**

HH stores `classDc: "trained"` for all 27 classes. The Archives print a Class DC line for 25 of them and for magus (`class-17`) and summoner (`class-18`) they print a **Spells** section instead ("Trained in arcane spell attacks / Trained in arcane spell DCs"). Exactly what I searched:

- `<title level="3">Class DC</title>` over the markdown of all 47 `class` docs: present on 45, absent on `class-17` Magus and `class-18` Summoner (also absent on the eight pre-remaster caster pages — Sorcerer/Wizard/Oracle/Witch/Bard/Cleric/Druid/Psychic legacy — which HH does not use, so the pattern is AoN's Secrets-of-Magic/legacy layout, not a scrape error).
- Regex `[Cc]lass DC` over the full markdown of `class-17`: **0 hits.** The only "DC" occurrences on that page are spell DCs ("Your spell attack rolls and spell DCs use your Intelligence modifier").
- Case-insensitive literal `"magus class dc"` and `"summoner class dc"` over **all 93 export files (438 MB of JSON)**: **0 occurrences each**, while the literal `"class dc"` occurs **3,053 times** in the same scan — so the search itself is demonstrably working.
- `class-17` and `class-18` have `supersedes: null` and no `data.remaster_id`, so there is no reprinted twin to fall back to; Secrets of Magic is the only printing the Archives hold.

So the Archives never state a Magus or Summoner class DC. HH's `"trained"` for those two records has no Archives source. Under hard rule 2 this is a question for you, not a decision for us — the likely answer is that Secrets of Magic genuinely gave those two classes a spell DC in place of a class DC, in which case the honest migration is to leave the field unset for them rather than assert `trained`.

**2. Two druid order focus spells — `cultivation-order` and `spore-order`.**

The remaster `druidic-order` docs are bare blurbs with no order-spell field and no order-spell sentence (`druidic-order-8` "Animal" is 3 lines of flavour and nothing else). For seven of the nine orders the spell is recovered through `data.legacy_id` → the Core Rulebook / Secrets of Magic doc, whose prose still reads "You gain the [_heal animal_](/Spells.aspx?ID=474) order spell." Cultivation (`druidic-order-3`) and Spore (`druidic-order-7`) are `neutral`-edition docs from Pathfinder #202: Severed at the Root with no legacy twin, and I found no order-spell statement on them. What I searched on those two docs: `data.spell` / `data.spell_markdown` / `data.hex_cantrip` (the fields the arcane-school, mystery and patron categories use — absent on the whole `druidic-order` category, 0 of 13 docs); every `**Bold Label** [spell link]` pair; the prose form "You gain/learn the _X_ order spell"; and `data.legacy_id` (empty). HH holds `cornucopia` and `mushroom-patch` for them. I did NOT search the two Pathfinder #202 sidebar/rules docs or the spells' own pages for a back-reference — that is the next place to look, and it is a 2-record question, not a systemic gap.

Three more things that look like gaps but are the reverse — **HH is missing data the Archives have**, listed here so they are not mistaken for Archives holes: the ranger's Nature training, the fighter's Acrobatics/Athletics choice, the animist's Nature/Occultism choice, the commander's Warfare Lore, and the animist apparition "Lamentation of Sinister Deals" (`apparition-14`, neutral edition) which HH's 13-option list does not contain. Details in edgeCases.

---

## feats-extra — the mechanical effects Heroes Heaven parses out of feat/heritage/ancestry/companion/vehicle text

Everything in my ten fields is in the Archives except the six items below. For each I state exactly what I searched, in both the 43,686-doc export and (where noted) `aon.db` directly. I have also flagged four places where the Archives DO answer but disagree with the app — those are not gaps, they are corrections, and they are listed after.

**1. The Awakened Animal ancestry's land Speed (1 record).**
`ancestry-72` prints an EMPTY Speed row. In the export: `data.speed` = `{}`, `data.speed_raw` = `""`, `data.speed_markdown` = `""`, no top-level `speed_max`. The markdown literally reads `<title level="3">Speed</title>` followed by nothing before `<title level="3">Attribute Boosts</title>`. I confirmed this straight out of `aon.db` with `select json from docs where id='ancestry-72'` — same three empty values. I then substring-searched all 93 export files for "awakened animal" and read every Speed-bearing line in every hit: the only speeds anywhere are on its heritages and feats (`heritage-288` Climbing Animal "You have a land Speed of 20 feet, a climb Speed of 20 feet", `heritage-289` Flying Animal "You have a land Speed of 20 feet", `feat-5300` Land Legs, `feat-5315` Full Flight, `feat-5317` Digger). Heroes Heaven's `{land:5}` for the ancestry itself is not on any page. The Archives' own model is that Awakened Animal has no ancestry Speed and the heritage supplies it — which is why the row is blank. **Question for you: should HH drop the ancestry's 5 and let the heritage set the land Speed, or is 5 a printed value I could not find?**

**2. Explosive Expert's splash-damage immunity (1 record).**
HH: `immunities: ["splash damage from your own Strikes with bombs and firearms"]`. I read BOTH printings in full — `feat-3290` (Guns & Gears Remastered, pg. 201) and its legacy twin `feat-8795`, reached through `supersedes`/`legacy_id`, not by name. Both say exactly and only: "You have continued training in volatile weapons and gained a deeper understanding. Whenever you gain a class feature that grants you expert or greater proficiency in certain weapons, you also gain that proficiency for simple and martial bombs and firearms." Neither contains the word "immune", "immunity" or "splash". I also searched the whole feat corpus for `/immun/` and Explosive Expert is not among the 19 docs that match.

**3. Svetocher's and Sanguine Tenacity's max-HP bonus (2 records).**
HH: `maxHpBonus: {perLevel:1}` on both. `feat-5714` Svetocher (Player Core 2 pg. 43) and its legacy twin `feat-1338` (reached by `legacy_id`) both talk only about the drained condition and Diplomacy training — neither mentions Hit Points except "your Hit Point reduction as though the condition value were 1 lower". `feat-7762` Sanguine Tenacity has no legacy or remaster twin at all and mentions HP only as "the penalties and lost HP from drained". I ran a `/hit points|maximum HP/i` scan over all 8,460 feat docs; 26 match and neither of these two is among them. These two `{perLevel:1}` values are Foundry's and I could not find them in the Archives.

**4. Versatile Mutation's repeat limit (1 record).**
HH: `maxTakable: 2`. `feat-5454` (Howl of the Wild pg. 70) has no `**Special**` line and no sentence containing "again", "more than once", "multiple times", "twice" or "a second time" — I scanned its full body. It does contain two separate choices ("bludgeoning or slashing" now, and one of five energy types at 8th level), which I suspect is what Foundry encoded as 2 takes.

**5. Constant Levitation's fly 40 (1 record).**
HH: `speeds: {fly:40}`. `feat-8343` says "You're affected by a constant _fly_ spell, and when your Psyche is Unleashed, you gain a +10-foot status bonus to your fly Speed." No number. I followed the link: both printings of the spell (`spell-125` legacy and `spell-1534` remaster) say "gaining a fly Speed equal to its Speed or 20 feet, whichever is greater" — which is `max(20, @actor.speed.land)`, not 40. The Archives answer the question, but the answer is not 40, so I have not changed it.

**6. `choice`'s engine vocabulary (all 97 records, partially).**
The option SET is in the Archives — measured, 67 of the 95 have every option label present verbatim on the feat page. What is NOT there, on any page, and cannot be: the `flag` key the engine reads (`houseOfPerfectionElement`, `shiftedArmorRune`), the `prompt` UI text, the `kind` discriminator (`array`/`text`/`open`/`skills`/`domains`), the `inert`/`note` strings that explain HH's own limitations ("Recorded, but it won't grant its benefit: the Remaster removed schools of magic…"), and the option `value` slugs (`feature:dynamo:automatic-percussive`, the hex colours `#0000FF`/`#43D6D6` on Crystal Luminescence, `ability str`, `proficiency level1`). These are Heroes Heaven's own vocabulary in exactly the sense `scripts/data/usage-slugs.json` and `scripts/data/book-names.json` already are: the Archives supply the fact, HH owns the words. The right shape is a learned-once `choice-options.json` mapping the Archives' printed option label to HH's value slug, generated the same way `gen-usage-slugs.mjs` was.
Separately, 17 of the 95 have their option list on a LINKED page rather than the feat's: Student of Perfection Dedication's four Houses are on the archetype page, `past-life`/`wisdom-from-another-life`'s 16 options are the skill list, `tooth-and-claw`'s 11 unarmed attacks are the awakened-animal sidebar table, `boost-modulation`'s seven boosts are on the Inventor class page, `chelaxian-scion-dedication`'s eight houses are on its archetype page. Those are reachable, but each needs its own hop — I have not built them.

**FOUR PLACES WHERE THE ARCHIVES ANSWER AND THE APP IS WRONG — these are not gaps.**

**A. The six undead dedications' immunity list.** ghost/ghoul/lich/mummy/vampire/zombie-dedication all carry `["death effects","disease","paralyzed","poison","sleep"]`. Their pages state only "you gain the [basic undead benefits](/Rules.aspx?ID=1694)". `rules-1694` grants immunity to **death effects only**, and goes out of its way to say why: "These are somewhat different from the normal undead creature abilities to better fit player characters"; disease and poison get "a +1 circumstance bonus to saving throws (or any other defense)", not immunity; sleep gets "while you don't sleep, you enter a state of quiescence for at least 4 hours a day". `trait-160` Undead grants none of the four either. So four of the five immunities on each of those six feats are Foundry's creature-statblock list and are wrong for a PC. Same shape as the wand/consumable find. **This one needs your decision before I change it.**

**B. Three feats where the printed repeat cap is stricter than the app's.** `vigilant-benediction` and `reclaimant-plea` print "a second time at 14th level… a third time at 18th level"; `settlement-scholastics` prints a second time. HH has all three as unlimited.

**C. Two vehicles that lost part of their printed Speed.** `atakebune` reads "30 feet (rowed)" in HH; `vehicle`'s `speed_raw` says "swim 30 feet (rowed)" — the movement TYPE was dropped. `geobukseon` reads "swim 30 feet (rowed)"; the Archives say "swim 30 feet (rowed, wind)". The other 13 vehicle differences are HH abbreviating AoN's fuller phrasing ("pulled (slowest pulling creature's Speed)" for "the Speed of the slowest pulling creature (pulled by 2 Large creatures)") and are a wording choice, not an error.

**D. Four HH self-inconsistencies in `senses` that only showed up because the Archives are consistent.** `"greater darkvision"` (shadowdancer-dedication) vs `"greater-darkvision"` (stalking-feline-mask); `"apparition sight"` with a space; a stray `acuity:"precise"` on `low-light-vision` in five records where the identical source sentence produced no acuity in eight others; and 17 animal companions storing AoN's own raw spacing, `"scent ( imprecise ) 30 feet"`.

---

## tail — classFeatures otherTags/critSpec/critSpecWeapons/grantedStrikes/resistances; vehicles ac/fort/space/crew/pilotingDC/collision/passengers; animalCompanions skills/abilities/support/maneuver; companionSpecializations.note; familiarAbilities.kind; runes.slot; conditions.valued; actions.tacticTier; stances.strikes; followers.notes

Two things in this domain are genuinely absent from the Archives. Everything else I was asked about is there, and where I could not produce a value it was because `used-docs.json` points the record at the wrong document — I have listed those separately below, because they are a pairing bug, not a data gap.

**1. The five follower type stat blocks (`followers.notes`, 5 records) — ABSENT.**

HH has Berserker, Medic, Scout, Sharpshooter and Shieldbearer, each with a `notes` string holding its skills, weapon and special ability. These are the Battlecry! follower types (Battlecry! pg. 77–79). Searches run:

- `sqlite3` over `aon.db` (43,686 docs confirmed by `select count(*) from docs`), exact name, case-insensitive: `Berserker` → 0 rows. `Shieldbearer` → 0 rows. `Medic` → only `archetype-69` and `archetype-257`, both the Medic *archetype*. `Sharpshooter` → only `warfare-tactic-20`, a Kingmaker army tactic.
- FTS over the same db for the stat-block labels that rules-3426 says a follower type must print: `"Kit Armor"` → 1 hit, `rules-3426` itself. `"Veteran Advancement"` → 1 hit, `rules-3426` itself. `"Sharpshooter" AND "Berserker"` → 0 hits.
- Full scan of the 43,686 export documents for `**Follower Ability**` → 1 hit, `rules-3426`. For `Experienced Advancement` → 1 hit, `rules-3426`.
- Full scan for any document mentioning three or more of the five names → 0 documents.

What the Archives DO have: `rules-3426` "Follower Types" (Battlecry! pg. 77), which describes the stat block *format* — "**Strikes** … **Attribute Modifiers** … **Hit Points** … **Kit Armor** … **Skills** … **Follower Ability** … **Special** … **Experienced Advancement** … **Veteran Advancement** … **Exceptional Advancement**" — and says "Each follower type has its own stat block and advancement, as follows", but no stat block follows and no document embeds one. Also present: `rules-3423` "Follower Actions", `action-3453` "Direct Follower", `action-3454` "Call Follower", and the feats `feat-7995` Additional Follower, `feat-7996` Experienced Follower, `feat-8000` Veteran Follower, `feat-8002` Exceptional Follower.

So the scrape captured the framing pages of the follower rules and not the five stat blocks they introduce. This looks like a scrape gap rather than an Archives-of-Nethys gap — the pages `rules-3426` points at are exactly the ones missing. **Worth re-scraping Battlecry! pg. 77–79 before concluding anything.** I did not check AoN online.

**2. `witch-elementalist-patron` (7 classFeature records) — no corresponding statement found.**

HH tags 7 of its 16 witch patrons with `witch-elementalist-patron`: devourer-of-decay, mosquito-witch, ripple-in-the-deep, silence-in-snow, the-inscribed-one, whisper-of-wings, wilding-steward. Searches run:

- All 27 `patron` documents inspected field by field: `data.type` is "Witch Patron Theme" on all 27, `trait_raw` is null or `["Rare"]`, `tradition` does not separate the 7 (they are Primal ×6 and Arcane ×1, while untagged patrons include Primal ones), `data.lesson` is null on all 27, and `book` does not separate them (Player Core ×3, Howl of the Wild ×3, Divine Mysteries ×1 tagged; Player Core ×4, Divine Mysteries ×3, Rival Academies ×2 untagged).
- Followed every granted spell link on all 27 patron pages and collected the element traits of the linked spells — only 2 of the 7 tagged patrons touch an element trait, and no untagged patron is excluded by that test.
- Regex over all 43,686 documents for `elemental(ist)?\s+(witch\s+)?patron` → 0 hits. For `elemental\s+witch` → 0 hits.
- Regex over all 43,686 documents for co-occurrence of `Wilding Steward` and `Silence in Snow` → 0 documents.
- Scanned every `archetype`, `feat`, `class`, `patron`, `rules` and `class-feature` document mentioning "elementalist" (36 documents) — all are the Elementalist *archetype* (`archetype-98`/`-207`) and its feat chain; none references patrons.

Context for the decision: `grep -rn "witch-elementalist-patron"` across `src/`, `test/` and `scripts/` returns **nothing**. No HH rule reads this tag, and it is not in `import-core.mjs`'s `SUBCLASS`/`EXTRA_CHOICES` tables, so it is inert Foundry metadata rather than a gate. Unless you can tell me what the tag is supposed to mean, my recommendation is to drop it rather than hunt further — but if it does mean something to you, tell me and I will look again, because that is the only reason I could be failing to find it.

**NOT absent — 44 records where the Archives have the data and the JOIN is wrong.** I want to be explicit that these are not gaps:

- otherTags, 38 records. `ruffian` is paired to `class-sample-69` when `racket-1` "Ruffian" exists; `thief`→`class-sample-15`, `scoundrel`→`class-sample-16`, `mastermind`→`creature-3612` (all rogue rackets); `fencer`→`class-sample-32`, `gymnast`→`class-sample-31` (swashbuckler styles); `bomber`→`class-sample-2`, `chirurgeon`→`class-sample-1`, `mutagenist`→`class-sample-3` (alchemist research fields); `battle`→`action-1422`, `blight`→`creature-family-561`, `time`→`domain-121` (oracle mysteries); `maestro`→`creature-3579`, `warrior`→`background-445` (bard muses); `lantern`→`equipment-2730`, `mirror`→`equipment-2735` (thaumaturge implements); `medium`→`class-sample-75`, `seer`→`class-sample-74` (animistic practices); `mosquito-witch`→`creature-1735` when `patron-10`/`patron-28` exist; `beast-eidolon`→`creature-3679`. The pattern is that `class-sample` and `creature` documents share names with class options and won the match.
- tacticTier, 2 records: `reload` and `the-bigger-they-are` (both exist as `tactic` docs).
- familiarAbilities.kind, 22 records: `augury`→`spell-1445`, `animated`→`equipment-2831`, and six `elemental-familiar-*` all pointing at the same `feat-4342`.
- critSpec, 2 records: `weapon-expertise` and `weapon-expertise-swashbuckler` are paired to the *Thaumaturge* and *Magus* Weapon Expertise pages respectively.

Also worth surfacing: `construct-companion` (animalCompanions) has no doc, but `rules-1600` "Construct Companions" (Guns & Gears Remastered pg. 32) is its page, with `rules-1601`/`-1602`/`-1612`/`-1613`/`-1614` embedded as its riding/prototype/advanced/incredible/paragon sections. It carries no `Support Benefit` or `Advanced Maneuver` line, so the four animal-companion fields genuinely do not apply to it — a construct companion has no support benefit in the rules.

---
