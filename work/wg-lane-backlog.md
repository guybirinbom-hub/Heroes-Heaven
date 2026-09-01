# Wanderer's Guide parity — lanes the engine does not have yet

Rows the parity pass wanted to write, that no field can carry. Each needs engine work before the
value is anything but inert. Written here rather than authored, because a field nothing reads is the
failure mode this project has shipped most often.

## From batch 001 — rows pulled after the suite showed they were inert

- **itemChoicePicker** — an ITEM carrying a `choice` renders no picker anywhere in the builder. Ten
  items are already stranded this way (`dweomerveil`, `storied-skin`, `stone-of-unrivaled-skill`,
  `fate-tempters-ring`, `muse`, `artistic-perfection`, `ancestors-call` …); Pact of the Herald and
  Host would have been the eleventh, and `test/inert-choices.test.ts` holds that line. Its
  `innateSpells.traditionFromChoice` is inert for the same reason — the answer it reads can never be
  given.

- **crossRecordSpellNote** — Greater Mercy adds a rider to Lay on Hands, which a DIFFERENT record
  grants. `spellNotes` asserts that the record naming a spell also grants it
  (`test/spell-notes.test.tsx`), so the note has nowhere to live. `modifiesGrant` is the likely
  route — it already carries `actionRider` for exactly this "my feat changes what another record
  gave you" shape.

## From batch 001 — reported by the pass, not yet attempted

These came back as `needs-new-lane` (15 of 100 records). The structural one is first because it
blocks the whole method, not just its own record:

- **⚠ `situational` on non-item records** — a FEAT's situational star can only be written into the
  `FEAT_SITUATIONAL` code table in `src/rules/situationalBonuses.ts`. `authoredSituational`
  (`src/rules/explain.ts`) reads a record-level `situational` field for ITEMS only. So *every*
  situational disagreement on a feat, class feature, background or heritage is unreachable from a
  decision file — a structural blocker on the parity method itself, not a quirk of one record.
  Fixing it needs the field on `ContentBase` and the reader widened; and the writer must REPLACE a
  record's entry list, because `entriesFor` only ever concatenates and "delete the way we did it"
  cannot be expressed by appending.

- **`actionMarks` / RECORD_MARKERS from data** — their `injectText` decodes to
  `{type:'action', id:<action>, text:…}`, which is exactly our `recordMark` lane (Ruling D). The
  DISPLAY half works for items; the DATA route does not exist. Wanted by `whip-tail` (Grab an Edge)
  and `boots-of-bounding` (Leap).
- **`itemGrantsAction`** — `MainTab`'s granted-actions walk covers feats, class features, heritages
  and backgrounds; inventory items are never walked. Wanted by Wish Blade → `conduct-energy`.
- **`untrainedProficiency` ladder** — the field is one number for a whole career and cannot say
  "level−2, improving at 5th and 7th". Measured on Untrained Improvisation: we give +3 at level 5
  where the book and they give +4, and +10 at 12 where both give +12.
- **`critSpecMinRank`** — crit specialisation gated on a PROFICIENCY RANK ("if you are at least an
  expert in such a weapon"). `critSpecLevel` gates on character level instead. Wanted by
  `mauler-dedication`; applies to every feat printing that clause.
- **`armorRankMirror`** — raise a named armour category to the rank a class feature grants in a
  different one. `featGrants.ts`'s own header records this shape as deliberately not modelled.
  Wanted by Invulnerable Rager.
- **consumable-mode writer** — the mode lane exists and is well populated, but a mode is a record in
  `scripts/data/toggle-modes.json`, and `apply-wg-parity.mjs` refuses any row whose record does not
  already exist, so the pass can create none. All 18 `potion-of-*-resistance-*` items need one.

## From batch 002 — 100 level-1 records (85 feats, 15 class features), items excluded

78 of 100 already agreed. Of the 22 that differed, only ONE was a value disagreement; the rest were
records where we built the first sentence and the second reached no surface. Five lanes wanted:

- **`critSpecWeapons.names?: string[]`** — ~4 lines, and the smallest lane on this list.
  `oni-weapon-familiarity` prints "…or with your horns unarmed strike". No existing route reaches it:
  `bases` matches `strike.base`, which for a natural attack is `natural:<index>`, never a slug;
  `groups:['brawling']` or `traits:['unarmed']` would light crit spec on Fist and every other unarmed
  strike; and `unarmedTraits[].critSpec` IS read by `applyUnarmedRiders` but `UnarmedRider` has no
  level field, so it would grant from level 1 against the printed "At 5th level".
  Wanted: `names?: string[]` on the `critSpecWeapons` shape, plus one line in `weaponMatches` inside
  the `narrowed` block. The level gate comes free — `critSpecWeapons` already reaches the strike
  through `CritSpecSource`, which carries this record's existing `critSpecLevel: 5`.

- **`actionMarks` / RECORD_MARKERS from data** — THIRD wanter, and the first that is not an item.
  `rune-singer` prints "you use the 2-action version of Trace Rune as a single action without needing
  an artisan's toolkit, and you remove the action's manipulate trait" and carries zero authored fields
  and zero registry entries — completely inert. `situational` cannot hold it (the clause changes an
  action's COST, TRAITS and REQUIREMENTS and names no stat; `SituationalTarget` mirrors `StatRef`, so
  a non-StatRef target can never display). `modifiesGrant.actionRider` is the one field route and is
  gated on `ownedIds.has(mod.from)` — feats + classFeatures only — while `trace-rune` lives in the
  ACTIONS bucket whose only granter is the level-6 archetype feat `tracing-studies`, so it would fire
  for archetype characters and stay silent for the runesmith class the app actually ships.
  ⚠ HIGHEST LEVERAGE ON THIS LIST. Their `injectText{type:'action'}` is one of their two commonest
  operations, and batch 002's rank-2 disagreement shape is "they put the clause on the ACTION row, we
  put it on the SKILL row" (Titan Wrestler ×5, Group Coercion, Rune Singer). Every later batch grows it.

- **resistance with a SOURCE qualifier** — `draconic-resistance` prints "Double this resistance against
  damage of that type dealt to you by dragons", and that clause is encoded nowhere. Measured: of every
  resistance entry shipped anywhere in core.json, ZERO carry anything beyond `{type, value}`, so there
  is no field to hold "against damage dealt by X".
  ⚠ WHEN THIS IS BUILT, USE THEIR VALUE, NOT OURS. Ours would be `2 × max(1, floor(level/2))`; theirs
  is `max(2, @actor.level)` — double the UNFLOORED half, then floor. They differ at every odd level
  from 3 up (L5: 5 vs 4), ten of twenty levels. The printed text reads our way — "resistance equal to
  half your level (minimum 1) … Double this resistance" doubles an already-floored number — but the
  owner's rule is absolute and theirs wins. Recorded here so the choice is visible rather than silent.

- **kineticist gate mode** — a subsystem, not a lane, and a rules error in the player's favour today.
  We ship `pickByLevel:{"1":2}` on the `element` group, so EVERY kineticist is forced to two elements
  at 1st level and Single Gate cannot be built at all. The printed text makes the impulse junction a
  Single Gate benefit only, yet the six `*-gate` junction entries in situationalBonuses.ts carry no
  gate-mode qualifier — so our dual-gate-only kineticists receive a junction the text does not grant.
  Needs a branch (`element` group to 1 pick), two 1st-level impulse feats of the one element, and a
  gate-mode condition on the junctions. `pickByLevel` is a flat level→count map with no branch.
  Belongs on the feature backlog with a design pass, not in the parity pass.

- **exemplar-derived damage type** (the `DRACONIC_EXEMPLAR_*` family, 240 of their operations) —
  DEFER. Nothing exposes an ancestry-level draconic exemplar: `build.dragonExemplar` and
  `SubclassOption.dragonChoice[].damageType` belong to the SORCERER Draconic bloodline, while
  `draconic-resistance` is a dragonblood ANCESTRY feat. Do not build a bespoke route for one record;
  let batch volume decide when the family is worth a lane.

### The tooling bug this batch found — fixed 2026-08-18

SIX of batch 002's sixteen rejections were one mechanical fault, not six judgements: a `situational`
row submitted without its `situationalReplaces` companion, or the flag without the array. In every
case the VALUE was right and only the packaging was wrong, and four verified rows were thrown away.

Both halves fail SILENTLY and in opposite directions, which is why reading did not catch it:
    array without the flag  ->  appends; the player reads our reading and theirs side by side
    flag without the array  ->  inert; the guard in explain.ts has nothing to replace

`apply-wg-parity.mjs` now settles it instead of asking the author to. Under the owner's rule, authoring
a `situational` value on a record that ALREADY ships one is always a replacement — there is no parity
case where showing both is the intent — so the flag is DERIVED from the shipped `FEAT_SITUATIONAL`
table, and a lone flag is refused as the inert row it is.

## Batch 003 closed — and the differ was lying by a factor of nine (2026-08-18)

Batch 3's 100 records were worked, and re-measuring afterwards showed **44 still THEY-ONLY**. Reading
them one at a time found **40 of the 44 were the instrument, not the work.** Eight separate blind spots
in `wg-diff.mjs`, each of which had been inflating every batch:

| # | blind spot | evidence it was wrong |
|---|---|---|
| 1 | registry keys had to be QUOTED | `gildedsoul: [...]` is a valid identifier; the record vanished |
| 2 | kinds were per-FILE, not per-TABLE | featFeatGrants.ts holds four tables; only one is conditional |
| 3 | `situationalBonuses.ts` flattened to `conditional` | every entry NAMES its targets; a +2 to Perception is a `perception` op on their side |
| 4 | ten registry files were not read at all | 286 feat ids: companionGrants 112, featGrantsLane 62, featCantripGrants 51, casterArchetypes 22 |
| 5 | `giveItem` always meant `grantsItem` | **236 of their 339** giveItem targets carry the Unarmed trait — those are our `grantedStrikes` |
| 6 | `giveAbilityBlock` always meant `grantsRecord` | of 1,552, **226 target a `sense`** and **38 a `mode`** |
| 7 | `createValue` always meant `specialStat` | their Lores are created that way (`SKILL_LORE_AXIS`) — a skill on our side |
| 8 | a `conditional` counted as a mechanic | it is a WRAPPER; Sea Legs' `IF SPEED_SWIM < 10 THEN set 10` is our `speeds: {swim: 10}`, which raises and never lowers |

Also: `languageChoices`/`loreChoices`/`skillChoices` now answer `choice` (a slot IS a selection), and
`whileActive[]` and `effectChoices[].options[].grant` are walked like `passiveEffects` (Acute Vision's
darkvision-while-raging and Proteankin's three daily resistances were both invisible).

**Corpus effect: the THEY-ONLY work list fell 1,153 → 568.** 585 records that were never gaps. Batch 3
itself went 44 → 0.

⚠ THE LESSON, again: four predicates lied earlier in this session and eight more here. A coverage
number is worth nothing until the thing producing it has been checked against records whose answer is
already known. The 19.2%-precision note at the top of wg-diff.mjs exists for exactly this and was still
not enough — measure the instrument every time.

### What was actually built

- **Rank-gated feat grants** (`FEAT_RANK_FEAT_GRANTS`, featFeatGrants.ts) — the lane neither
  `FEAT_FEAT_GRANTS` nor `grantsFeats` could express, because both are unconditional. Stonemason's Eye
  ("if you're ALREADY trained in Crafting, you instead gain Specialty Crafting for stonemasonry") and
  Gildedsoul ("if you're trained in Society, you also gain Courtly Graces"). `countOwnGrant` is the
  printed difference between them and is not cosmetic. Specialty Crafting is bound to stonemasonry, as
  WG and Foundry both preselect it.
- **Gildedsoul moved off `effectChoices`** onto a `skillChoices` slot with `redundantFallback`, which is
  the only authoring that can carry *"if you would automatically become trained in BOTH … a skill of
  your choice instead"*. `LEGACY_SKILL_SLOT_KEYS` in build.ts keeps a pick saved under the retired key
  (shipped v0.1.16, live six releases) from silently reverting to Diplomacy.
- **Innate spell proficiency at 12th level** — Player Core p.298: *"At 12th level, these proficiencies
  increase to expert."* The innate entry was a flat `'trained'`, so every character with an innate
  spell rolled and set DCs one rank low from 12th to 20th. Systemic, not one record; found because WG
  encodes the threshold on 40 records, then confirmed from the AoN mirror (rules-2232).
- **The stance-strike lane — all 24 records.** 100 stance-trait records, 24 print an unarmed attack with
  dice, **0 shipped one**: a monk in Tiger Stance had no tiger claw, and the only Strikes the stance
  permits were unavailable. Authoring only batch 3's own Twisting Petal Stance would have left 23
  identical holes. Claw/Talon Stance are `actions` records and `grantedStrikes` is NOT read from that
  bucket, so both were re-homed onto Clawdancer Dedication, which grants them.
- **Dragonet Breath** — a DC statistic plus the five-heritage row picker, in the same shape Kobold
  Breath already uses for a printed table this data source does not carry.
- **Metal Carapace** — the two items the impulse creates. `armorRestat` was checked and rejected: its
  reader is gated on an inventor's `inv.designations` and reads only class features, and the printed
  text suppresses your real armour rather than restating it.

### Settled, not fixed — recorded in `VERIFIED_EQUIVALENT` (wg-diff.mjs)

Four rows survive every vocabulary fix and are still not gaps. Named per-kind with their evidence so
they stop costing a re-read each batch, while anything unlisted still reports:

- **shoony-lore** — their row grants the Additional Lore FEAT (which also carries its 3rd/7th/15th
  extra skill increases). Its text says only *"you also become trained in Shoony Lore"*. The peers whose
  text DOES say "you also gain the Additional Lore general feat" — catfolk-lore, tengu-lore,
  dwarven-lore — are authored that way here. Ours matches its own printed text; theirs matches
  catfolk's. Not adopted, because the two records print different sentences: this is not one clause read
  two ways, it is their template applied to the wrong record.
- **made-for-combat** — all three strikes ship; their items 16613/16614/16615 carry only the printed
  traits and not the Unarmed trait, so rule 5 above cannot see them. Their data, not ours.
- **pantheon-magic** — the proficiency half is now engine-wide, so no field on the record can show it.
- **fear-no-law-fear-no-one** — their row encodes a fear degree-shift this record does not print; that
  clause is printed on bravery, goloma-courage, emotionless, grim-insight and dragons-presence.

### Left standing, deliberately

- **Stance strikes are UNGATED.** `grantedStrikes` has no mode condition — 0 of 186 shipped entries
  carry one — so a stance strike shows whether or not you are in the stance. This matches what WG does
  (a bare `giveItem`, no condition) and what the app already did for every other natural attack.
  Gating them on their stance is a subsystem, and half-building it is worse than the honest gap.
- **"Medium armor but uses your highest armor proficiency"** (Metal Carapace) has no field. Recorded in
  the item's own note rather than faked; a wrong proficiency is worse than a stated limitation.
- **Two `damageType` fields already hold Foundry template text** — `{item|flags…objectDamageType}` and
  `"as your mind weapon"` — from an earlier import. Found while reading the grantedStrikes vocabulary.
  Not this batch's record; worth a pass of its own.
- **AoN's plain-text `description` is lossy in a way the display tree is not.** "a 15-foot cone" comes
  through as "a ", and a lone damage-type word can vanish ("These deal 1d8 damage" for Mountain Stance's
  bludgeoning). The AST in `public/ast/` keeps both, and DescBody prefers the AST — verified before
  authoring — so the player reads the right prose. But any SCRIPT that parses the description is reading
  the lossy copy: five of the 24 stance strikes had to be resolved from the mirror's markdown instead.

## The bucket I had never worked: VALUE disagreements (2026-08-18)

Asked "so everything implemented differently from WG in batches 2 and 3 was fixed?", the honest answer
was NO, for two reasons I had not been reporting:

1. **Batch 2 still had 10 records missing a mechanic.** It was closed under the OLD differ; they were
   reported then and stayed open.
2. **Neither batch's VALUE disagreements had ever been touched.** `wg-diff.mjs` answers "does the other
   side model this KIND of thing at all". It does not answer "do we grant +1 where they grant +2", and
   the owner's rule is mostly about the second. 37 records in batch 2, 37 in batch 3, **469 corpus-wide**,
   all flagged and none compared.

### `scripts/wg-values.mjs` — new

Extracts every (variable → value) their operations assert, extracts the same assertions from ours, and
prints only the pairs that disagree. Handles what the kind-differ cannot:

- **conditional bonuses.** Their vocabulary has no such thing, so *"+1 circumstance to Perception and
  Will saves against illusions"* is a flat `addBonusToValue PERCEPTION = 1` with the condition in prose.
  Ours is a `situational` whose bonus is the STRING "+1 circumstance". The MAGNITUDE is what is worth
  comparing, and ten of batch 3's records were correctly authored and read as "they grant, we do not".
- **scaling bonuses.** Contract Negotiator's is one string — *"+1 if expert in Diplomacy, +2 if master,
  +3 if legendary"* — and their side asserts the top. Taking only the first number said we grant 1 and
  they grant 3, on a record that grants all three.
- **speed formulas.** `min(@actor.speed.climb,1)*(@actor.speed.climb-15)+20` evaluated at zero recovers
  the 20 their `setValue` states.
- **whole-track conditionals.** Ours writes `detail: 'all'`; theirs writes three per-save operations.
- **SET-valued variables.** Weapon familiarity and resistances assert membership, one operation per
  member, with trait ids mixed in among weapon names (Elven Weapon Familiarity is `"1348"` = the elf
  trait, plus five bases). Their trait table resolves the ids.

⚠ Four bugs in the comparer itself, all found by it reporting a record I then read and found correct:
the situational body regex missed `detail: 'all'`; a later writer clobbered an earlier one for the same
key (Earned Glory both trains Performance AND shifts its degree, and the shift won); the grant TABLES
were not read at all, so three weapon-familiarity feats reported empty lists; and the weapons regex
required a quoted key, which featGrantsLane does not use. **Measure the instrument. Every time.**

**`⚠ NOT value-checked` is printed separately from "agree"** — 44 records per batch assert nothing this
script can compare (38 are prose-only with no number; 8 are `PRIMARY_SHEET_TABS`, pure UI plumbing the
kind-differ already excludes). Counting those as agreement is the "reports coverage it does not have"
failure this project has now been bitten by three times.

### Result

| | batch 2 | batch 3 |
|---|---|---|
| missing a mechanic (THEY-ONLY) | 0 | 0 |
| value disagreements | 0 | 0 |
| records value-compared | 42 | 41 |

### Fixed in this pass

- **draconic-resistance offered 5 damage types; a draconic exemplar can have 10.** The five we shipped
  are the SUBSTITUTE list the feat gives a physical-damage exemplar — not the list of types an exemplar
  can be. A player whose exemplar was a spirit or void dragon could not record their resistance at all.
  Added force, mental, poison, spirit and void, each built by copying a shipped option so the
  doubling-against-dragons row cannot drift, and the script refuses to write if any option loses it.
- **azarketi-weapon-familiarity** now names the `azarketi` TRAIT as well as enumerating its two weapons.
  Both were correct today — measured, boarding-axe and gill-hook are the only two — but an enumeration
  stops covering the feat the moment a refresh adds a third, and their side names the trait.
- Four more differ blind spots: `unarmedTraits` did not answer `weapon` (Iron Fists), an INLINE
  `situational` field's targets were not walked (only the registry copy was — Storm Born), and a
  `degreeShifts` entry did not answer the track it names (Sure Feet, Sturdy Bindings, Fire Savvy).

### Settled with evidence, not fixed

`VERIFIED_EQUIVALENT` in wg-diff.mjs (kinds) and `SETTLED_VALUES` in wg-values.mjs (values) now carry
eleven entries between them, each with the reading that settled it. Batch 2's five:

- **deitys-domain** — their `giveAbilityBlock` points at `feat/Domains`, a container record.
- **foxfire** — we ship all THREE damage types including the frozen-wind-kitsune cold their encoding
  omits; their two items lack the Unarmed trait so the giveItem→weapon rule cannot see them.
- **draconic-aspect** — their `createValue DRAGONBLOOD_ASPECT` is plumbing with exactly ONE reader in
  the whole dump (feat/Deadly Aspect). Ours needs no variable: `deadly-aspect` ships
  `unarmedTraits: {match: ['claw','jaws','tail'], add: ['deadly-d8']}`, and only one of the three exists.
- **initiate-warden** — their `defineCastingSource RANGER/PRIMAL/ATTRIBUTE_WIS` + trained is produced by
  the engine, so no field can show it. Pinned by test/initiate-warden-focus.test.ts.
- **circle-of-spirits** — already modelled, and more faithfully: build.ts implements the printed
  *"equal to the number of focus spells you have or the number of apparitions you are attuned to,
  whichever is higher (maximum 3)"* against the 1/7/15 apparition ladder. Theirs is a flat +1.

And two value rows:

- **oni-weapon-familiarity** — their crit-spec member is "hungerseed horns"; ours matches by the strike's
  own name, and `heritages/hungerseed` grants one named exactly "Horns", which is how the printed clause
  names it too (*"or with your horns unarmed Strike"*).
- **quadruped** — *"Your Speed is 30 feet."* Theirs assigns; ours is `landSpeedMin`, a floor applied
  before additive bonuses. Identical for every character that can exist: poppet base land Speed is 25,
  the feat is `onlyAtLevel: 1`, and MEASURED — no record anywhere carries a land-Speed floor above 30.

### ⚠ One place their number contradicts the book

**summiting-dragonblood** — Draconic Codex feat-8077 prints *"a climb Speed of 20 FEET"*. Their row sets
it to 15. Ours evaluates to 20 with no existing climb Speed and existing+5 otherwise, which is the
printed rule exactly. NOT adopted. The printed text is the authority — Paizo's, under ORC — and their
data is evidence that a lane may be missing, never the source. Recorded here so the choice is visible
rather than silent, exactly as the draconic-resistance value note above it is.

## The THIRD bucket: IDENTITY (2026-08-18)

Asked the same question a second time, and the answer was still no. Kinds were at 0 and values at 0,
but neither compares WHICH THING. If their record grants Courtly Graces and ours grants Assurance,
both report `grantsRecord`, both agree on every number, and the two are not the same feat.

`scripts/wg-identity.mjs` — new. Compares their `giveAbilityBlock` / `giveSpell` / `giveItem` /
`select` option labels against our `grantsFeats` / `grantsActions` / `innateSpells` / `focusSpells` /
`grantsItems` / `grantedStrikes` / choice options, by NAME.

⚠ Four bugs in it, every one found by it flagging a record I then read and found correct: it took only
the FIRST entry for an id in a registry file (Quah Bond is in FEAT_GRANT_BOUND_CHOICE *and*
FEAT_FEAT_GRANTS, so it read the binding and called the grant missing); it never read the grant TABLES,
where the skillChoices options live; it could not match a different WORD ORDER ("Nagaji Lore" vs
`lore:nagaji`); and it did not read `grantsActions` at all.

### The real find: five ancestries never granted their unarmed attack

Iruxi Armaments’ Claws branch upgrades *"your claw attack"* — and `ancestries/lizardfolk` shipped no
claw. Measuring instead of fixing the one: **5 ancestries print an unarmed attack and 0 shipped one.**

| ancestry | attack | dice | group + traits |
|---|---|---|---|
| lizardfolk | Claw | 1d4 slashing | brawling, agile, finesse |
| minotaur | Horns | 1d8 piercing | brawling |
| kholo | Jaws | 1d6 piercing | brawling |
| tengu | Beak | 1d6 piercing | brawling, **finesse** |
| sarangay | Horns | 1d6 piercing | brawling, shove |

Not cosmetic: every lizardfolk was missing their signature attack, and four feats that modify it BY
NAME were inert on it — `protective-claws` (parry), `iruxi-unarmed-cunning` (crit spec),
`fearsome-fangs` (sets the die), and Iruxi Armaments itself.

⚠ TWO parsing traps, both caught by printing what was parsed and refusing to default:

- **The group and traits are usually in the NEXT sentence.** *"…deals 1d6 piercing damage. Your beak
  is in the brawling weapon group and has the finesse and unarmed traits."* A one-sentence window
  produced a tengu beak with NO finesse — a wrong strike, which is worse than a missing one.
- **An ancestry has two printings and they differ.** Lizardfolk’s legacy text names no weapon group;
  the remaster reprint does. Keeping the LONGER markdown picked the legacy one, and the
  refuse-on-incomplete guard is what surfaced it.

### Iruxi Armaments’ third branch, and a new engine gate

Fangs and Tail GRANT an attack; Claws UPGRADES one — *"Your claw attack deals 1d6 slashing damage
instead of 1d4 and gains the versatile P trait."* That half had no authoring, and `UnarmedRider` had
no way to say "only on this branch of the granting record’s choice". I asserted in a comment that it
did, CHECKED before writing, and it did not — without the gate every iruxi who picked Fangs would also
get the claw upgrade. Added `UnarmedRider.choiceValue`, mirroring `grantedStrikes[].choiceValue`,
failing CLOSED on an unanswered choice. Pinned by three tests.

### Quah Bond offered ANY skill

Printed: *"the trained proficiency rank in THE SKILL LISTED FOR YOUR QUAH (or another skill of your
choice, if you’re already trained in that skill)"*, then seven quahs and their skills. The primary
slot is those seven; the any-skill half is the parenthetical, which `redundantFallback` already
delivered. Offering ‘any’ up front let a player train a skill no quah grants AND skipped the fallback,
because the slot was never redundant. Narrowed to the seven — which is also what they offer.

### Result — all three buckets, both batches

| | batch 2 | batch 3 |
|---|---|---|
| missing a mechanic | 0 | 0 |
| value disagreements | 0 of 42 compared | 0 of 41 compared |
| identity mismatches | 0 of 30 checked | 0 of 37 checked |

Six identity rows read and settled in `SETTLED_IDENTITIES`: deitys-domain (a container record),
iron-fists (their pre-modified item vs our rider), tough-skin (named after the ancestry, not the
feat), shoony-lore (the recorded disagreement), iruxi-armaments (they replace the claw, we upgrade it
as printed), orc-warmask (four items vs our one item plus a four-way choice).

### Still not verified, and named so it is not mistaken for done

Per batch, ~38 records assert a bonus in PROSE with no number (`addBonusToValue` with only a text
field). The kind-differ sees that both sides model a skill or a save; the value comparer has no number
to compare; the identity comparer has no named thing. Their WORDING versus our authoring is therefore
unchecked by any of the three instruments — it needs reading, not measuring.

## The entry two settles promised and nobody wrote: `merchants-scale` (2026-08-19)

`VERIFIED_EQUIVALENT['merchants-scale']` (wg-diff.mjs) and `SETTLED_VALUES['merchants-scale']`
(wg-values.mjs) each close the record with *"Recorded in work/wg-lane-backlog.md"*. **It was not.**
Both registries had stopped the record being reported, and the thing they deferred was handed to
nobody — so the item has been invisible to the pass that would have found it for as long as both
settles have existed. Written now, with the measurements, so the next pass starts where this stopped.
`test/wg-backlog-citations.test.ts` now fails on any settle that cites this file for a record the file
does not mention; it reproduced exactly these two and nothing else.

### What the record ships today

`items['merchants-scale']` — level 0, 2 sp, Bulk L, Hands 2, `usage: held-in-two-hands`,
`itemType: 'equipment'`, `source: {book: 'Pathfinder Player Core', license: 'ORC'}`, **`description: ""`**,
no `situational` entry, no skill grant. The settles are right that their flat +1 to seven skills is a
flattening — every one of their seven `addBonusToValue` ops carries the condition in its own text —
but ours prints nothing at all, which is its own defect.

### Why it is still not fixed: the printed body could not be sourced

The blocker is not judgement, it is that **no ORC/OGL source available to this project carries the
item's descriptive paragraph.** Five checked on 2026-08-19, all empty:

| source | result |
|---|---|
| AoN mirror `equipment-2734.json` (Player Core pg. 290) | stat-block stub; `text` ends at `Bulk L ---` |
| AoN mirror `equipment-34.json` (legacy CRB pg. 288) | same stub |
| live AoN `2e.aonprd.com/Equipment.aspx?ID=2734` | Source/Price/Hands/Bulk, no body |
| live AoN `…ID=34` (legacy) | no body |
| Foundry `.import-src/pf2e/…/merchants-scale.json` | `description.value` empty, `rules: []` |

That is a genuine gap, not the norm for the table: **192 of 5,645** Foundry equipment records have an
empty description, and every sibling checked (Compass, Climbing Kit, Magnifying Glass, Merchant's
Guile) carries its printed prose. Roll20's PF2 compendium is empty too. PF1's merchant's scale — *"+2
circumstance bonus on Appraise checks"* — is a DIFFERENT edition with a different mechanic and must
not be imported to fill the hole.

The only place carrying the PF2 wording is the **Wanderer's Guide dump, which is GPL and must not be
copied.** Its seven ops read *"to Recall Knowledge checks to determine the value of items, gems, or
precious metals"*, which is evidence a lane is missing — never the source. Per the rule already
recorded here for `summiting-dragonblood`: the printed text is the authority, and where we cannot read
it we record rather than invent.

**⚠ This needs the physical Player Core pg. 290, and nothing else will do.** Do not author the
sentence from the WG data, from PF1, or from this file's paraphrase of the claim.

### The second blocker, measured — the fix would be inert even with the text

Authoring `situationalBonuses['merchants-scale']` today produces **nothing on the sheet**, and it would
look authored. `characterSituationalIds` (explain.ts:234) admits an item only while
`inv.equipped || inv.worn || inv.invested`, and merchant's scale can never hold any of the three:

- `equipControl` (InventoryTab.tsx:73) returns a Wear/Wield button only for `armor` / `weapon` /
  `shield`, plus an Invest button for the `invested` trait. Merchant's scale is `equipment`, untraited
  → **no control renders**.
- the drag-to-Equipped route is gated by `isEquippable` (InventoryTab.tsx:709), the same four tests
  → **blocked**.
- those are the only two equip controls in `src/` (`ItemDetail.tsx:549` only ever moves an item back
  to carried).

Observed, not inferred: forcing `equipped`/`worn`/`invested` on an inventory row makes
`statHasSituational` fire for `lantern`, `cauthooj-bagpipes`, `thieves-tools-concealable` and
`maestros-instrument`; leaving it merely carried returns false for all four. **The engine half works;
the UI can never set the flag.** `merchants-guile` is reachable only because a ring carries `invested`.

**This is bigger than one item.** Of 2,790 `FEAT_SITUATIONAL` ids, 1,571 are items and **820 are keyed
to an item with no equip route** — 396 consumable-ish (a different lane: a drunk elixir is not a worn
ring) and **424 persistent gear** that a player holds or uses and can never mark as in use. That 424
is a measured upper bound needing triage, not 424 confirmed-dead entries: some are precious-material
placeholders (`noqual-ingot`, `sovereign-steel-chunk`) whose bonus may belong elsewhere entirely. But
`lantern`, `thieves-tools-concealable`, `cauthooj-bagpipes` and `maestros-instrument` are plainly real
gear with real printed bonuses and no way to switch them on.

### The shape to apply, once pg. 290 is in hand

Both halves are needed; either alone is a defect.

1. **The description** goes in `scripts/data/effect-backfill.json`, then `node
   scripts/import-siege-and-gaps.mjs`. ⚠ Writing it straight into `public/core.json` dies at the next
   `npm run data`.
2. **The bonus** goes in `FEAT_SITUATIONAL` in `src/rules/situationalBonuses.ts`, in the pre-banner
   region (lines 85–432), as a **starred conditional** in the `merchants-guile` shape — one entry per
   skill the printed sentence actually names, each carrying the condition and the in-use qualifier:

   ```
   "merchants-scale": [{ targets: [{ kind: 'skill', detail: '<skill>' }],
     when: "<the printed condition> (scale held)", bonus: "+1 item" }, …],
   ```

   Hand ADDITIONS to that file survive: `apply-situational-lane.mjs` builds `existingIds` from the live
   file and skips any id already present. Deletions do not.
3. **The equip route must exist first**, or step 2 is inert — see above. The narrow fix is a Hold/Use
   control for `equipment`-typed items that carry a `usage` of `held-in-*`; the honest fix is the
   424-entry triage.

**Do NOT adopt their encoding.** A flat +1 to Arcana, Crafting, Medicine, Nature, Occultism, Religion
and Society would raise all seven on *every* check for carrying a 2 sp balance.
