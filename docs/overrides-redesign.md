# Tweaks (the Overrides redesign): design draft

Status: DESIGN FINISHED 2026-10-14 (Guy accepted the feature list; an independent final check ran and
its findings are in Part 2's "Phase 1 build spec"). Nothing is built yet. Each build phase runs in its
own chat; the phase 1 prompt is in Part 3. The new name is **Tweaks** (Guy, 2026-10-14).

- **Part 1** is for Guy: what exists, what is broken, the feature ideas, the names, the questions.
- **Part 2** is for the chat that builds it: the code facts behind every line of Part 1.

---

# Part 1 — for Guy

## Decisions so far

Guy's answers, 2026-10-14:

1. **Name: Tweaks.** One change is "a tweak".
2. **Builder only.** Tweaks are for players who need a change once in a while, for their own reasons. It
   is not something they do often. No "Change this" button on the sheet.
3. **The GM sees tweaks only by opening the builder where the player made them.** No GM list, no GM
   marks, no approval step.
4. **On the sheet: a breakdown line only.** The sheet looks normal. A tweaked number's breakdown has one
   line, "Tweak: +1 (reason)", so the math adds up. No marks next to numbers.
5. **Classes: give the player every tool.** Each extra class has:
   - the levels it covers: all levels (stacked, like Dual Class) or a range like 4–10 (classic
     multiclass);
   - switches for what it gives: HP, proficiencies, skills, feat slots, class features, spellcasting;
   - how HP and proficiencies combine: best of, or added;
   - its own class DC.
6. **Homebrew versus Tweaks.** Homebrew is for making something that lasts, for the whole account; it
   will get more complete later. Tweaks may also CREATE new things, but only for this one character.
   (This replaces the old rule that new content belongs only in Homebrew.)
7. **Removing: ask each time.** Two buttons: "Only this" or "This and what it gave".

Guy's answers after the gap search, 2026-10-14:

- **Companions are in Tweaks** (feature 48), in phase 3: tweak an existing companion, familiar or
  eidolon. A brand-new creature is not part of it.
- **Deity for any class is NOT a tweak.** It is a normal builder fix (feature 47), done in its own chat,
  together with the Cleric Dedication bug.
- Default: a rank given by a tweak means "at least" (feature 46); "exactly" is a separate choice.

My defaults for the questions not asked yet (they stand unless Guy says otherwise):

8. The Tweaks switch in Options: switching it off pauses every tweak, after a confirm that lists what
   turns off. (Today it only hides the card.)
9. "Set" and level-up: a +/- keeps working at every level; a "set" number warns at level-up when the
   book number under it changed.
10. Text on the card: the tweaked text replaces the book text, with a "Show original" switch.
11. Rename: the new name shows everywhere, with the book name small underneath.
12. A data update changes a record you tweaked: the tweak stays, and the builder flags it with a compare
    view.
13. A tweak points to something that no longer exists: it shows as broken, with "Remove" and "Point to
    another". It is never dropped.
14. Rule-breaking happens in both places inside the builder: buttons in each picker where the need comes
    up, and one Tweaks panel that lists everything.
15. A +/- always adds (outside the PF2e bonus types). Choosing a bonus type is optional (feature 6).
16. Modes stay a separate system (they are for switching on and off in play).
17. No "ignore all rules" switch: each rule break is its own tweak, chosen one by one.
18. Build chats: one chat per build phase. The first prompt is for phase 1; this file holds the rest.
19. Old characters open as before: their changes stay on and are listed as "Moved from Overrides".
    Numbers move only in three cases, all fixes: a skill increase that the old Overrides swallowed now
    counts; a rank you lowered now stays lowered; a set max HP now keeps a Mode's HP bonus. Things the
    app adds on import from now on (rituals, leftover feats) are never paused by the switch. Leftovers
    from older imports can't be told apart from your own changes, so they show as normal tweaks, and the
    switch-off confirm names them.
20. Deleting a tweak in the Tweaks panel asks nothing (it is not "removing a thing" from decision 7).

## What Overrides can do today

Builder → Setup → Options → switch on "Overrides". A card then appears with 9 parts:

1. Take a feat even if you don't meet its prerequisites (a "Take anyway" button in the feat picker).
2. Give yourself a feat or a class feature.
3. Remove a feat that the rules gave you.
4. Set an attribute score to a number.
5. Set maximum HP to a number.
6. Set a proficiency rank (skills, saves, Perception, weapons, armor, class DC).
7. Add a language.
8. Add a spell (as an innate spell) or a ritual.
9. Change a feat's or class feature's name and description.

## Problems in today's Overrides (fix these in any design)

1. Switching "Overrides" off only hides the card. Every change still works on the character.
2. A changed description mostly does not show. When a record has an Archives page, the card shows that
   page, not your text. A changed name does not show on the card either.
3. A class feature you give yourself is only a name in the list. Its bonuses, uses and defenses do nothing.
4. Removing a feat leaves everything that feat gave you. A removed focus feat probably still gives its
   focus point.
5. A proficiency you lower can come back up, because later steps of the build raise it again.
6. You can only give yourself feats up to your current level.
7. The sheet shows almost no sign that something was changed (only the max HP line and the "Added spells"
   group). The GM sees nothing at all.
8. If a change points to something that no longer exists after a data update, the change silently
   disappears. A description change for a missing record cannot even be removed.
9. The app itself also writes into Overrides: an imported character puts leftover feats and rituals there.
   So your own changes and import leftovers are mixed together.
10. A proficiency you set wipes your own later increases. Example: you set Stealth to trained, then spend
    your level 3 skill increase on Stealth. The app writes Stealth back to trained, and the increase is
    lost with no warning. (Found by the gap search, 2026-10-14; see feature 46.)

## Things the app already has outside Overrides

- **Modes**: bonus sets you switch on and off in play (for example a stance). They can already add +/- to
  about 14 stats. But they are saved on the device only, and they do not travel with the character to
  the GM.
- **Item editor** (Inventory): edit an item, including always-on bonuses and conditional notes. Editing a
  book item makes a copy for all your characters.
- **Homebrew page**: make new items, feats, spells, ancestries, heritages, backgrounds, actions and
  deities (not classes). Shared by all your characters.
- **Variant rules**: Dual Class (the only way to have 2 classes today), Free Archetype, and others.
- **Deep background**: build your own background.

## Feature list

⭐ = my "build this first" pick. "You asked" = from your message. "Idea" = my suggestion.
How hard: **easy**, **medium**, or **hard** (hard = it touches many parts of the app and needs its own
build phase).

### A. Numbers on the sheet

1. ⭐ **Bonus or penalty on any stat** (you asked · medium). "+1 Athletics", "−2 AC", "+5 max HP". It
   always adds and ignores PF2e bonus types. It shows as its own line in the stat's breakdown:
   "Tweak: +1 (reason)".
2. ⭐ **Set a stat to an exact number** (you asked · medium). "My AC is 20." Today only attribute scores,
   proficiency ranks and max HP can be set. Option: "at least N" ("my Speed is at least 30").
3. **Set one part, the rest keeps counting** (idea · medium). Example: set "HP per level" to 12 instead of
   setting the total HP, so level-up still works. Other apps' biggest complaint is a set number that
   stays frozen after level-up.
4. ⭐ **Start at a level, or grow with level** (idea · medium). Any change can say "from level 5",
   "+1 more at levels 5, 10 and 15", or "half your level".
5. **Note-only change** (idea · easy). "+2 vs poison" as a star note on the stat, with no change to the
   number. It works like the situational stars the app already shows.
6. **Choose the bonus type** (idea · easy after 1). Optional: make your +1 a status, circumstance or item
   bonus, so the normal PF2e rules decide if it adds.
7. **Stats and limits with no row today** (idea · hard). HP per level, Bulk limit, max focus points, max
   hero points, reactions per round, reach, the investiture limit (10 invested items), mythic points,
   class resource pools (alchemist vials, prepared tactics, etched runes, Advanced Alchemy, daily scroll
   slots), and the Dying and Doomed limits. The sheet blocks at some of these limits (for example the
   Invest and Prepare buttons switch off), so raising them is a real need.
8. **Defenses, senses, speeds, size and traits** (idea · adding is medium, removing is hard). Add or remove
   a resistance, weakness or immunity, darkvision, a fly speed. Change your size. Add a trait like
   "undead".
9. **Strikes** (idea · medium). Extra damage ("+1d6 fire"), a bigger damage die, add or remove weapon
   traits, a new unarmed attack (claws, horns), critical specialization for a weapon.

### B. Choices in the builder

10. ⭐ **"Take anyway" in every picker** (you asked · easy to medium; today feats only). Ignore
    prerequisites for spells, skills, heritage, subclass, deity, and archetype rules (for example "take
    2 feats before your next dedication").
11. ⭐ **Pick from any list** (you asked · medium). A general feat in a class feat slot, a feat from another
    ancestry, a feat above your level, or a feat more times than it allows ("the GM let me take Fleet
    twice"; today a second copy of the same feat does nothing).
12. ⭐ **Add a choice place** (you asked · medium to hard). An extra feat slot (any kind) at level X, an
    extra skill increase, an extra attribute boost, an extra class-feature choice, an extra cantrip or
    spell known.
13. **Remove a choice place** (you asked · medium). Remove a slot you don't want. If you already picked
    something there, it stays as "a feat with no slot"; it is never lost silently.
14. **Change a choice inside something you have** (you asked · hard). Example: a feat lets you pick a
    skill from a list. You pick a skill that is not on the list.
15. **Add or remove options in a choice list** (you asked · hard). Example: add "fire" to the list of
    energy types a feat offers.

### C. Give and remove

16. ⭐ **Give anything** (you asked · easy to medium; today feats and class features). Feats at any level,
    class features, ancestry features, heritages, actions, reactions, items. Everything you give must
    really work (today a given class feature does nothing).
17. ⭐ **Remove anything** (you asked · hard; today feats only). Class features, ancestry and heritage
    features, spells, languages, proficiencies, senses.
18. **"Only this" or "this and what it gave"** (idea · medium). When you remove something, you choose if
    the things it gave you go too.
19. **Give a spell your way** (you asked · medium; today innate only). Choose how you cast it: at will,
    X times per day, from your spell slots, or as a focus spell.
44. ⭐ **Add a Lore** (Guy asked, 2026-10-14 · easy). Type any subject ("Sailing Lore") and pick its rank,
    trained to legendary. Today the engine can already hold a Lore rank, but the builder's "Change
    proficiency" list offers only the 16 skills, saves, Perception, weapon and armor categories and class
    DC: there is no way to add a Lore.
45. **Proficiency in one weapon or weapon group** (idea · medium). "Trained in longbows" or "expert with
    swords", not only a whole category like "martial weapons".

### D. Classes and spellcasting

20. **More classes** (you asked · hard). A third class, a fourth class, with the tools in decision 5.
    This is a big job: "2 classes" is written into about 40 places in the app today.
21. **Give spellcasting** (you asked · hard). A full spellcasting entry: prepared or spontaneous, a
    tradition, a key attribute, and a slot table ("like a wizard", "half caster", or your own numbers).
22. **Remove spellcasting** (you asked · medium to hard). A class without its spells, or remove one
    spellcasting entry.
23. **Change spellcasting** (idea · medium). Change the tradition, prepared ↔ spontaneous, the key
    attribute; add slots per rank; add cantrips.
24. **Change class basics** (idea · medium). Key attribute, HP per level, starting proficiencies, trained
    skills, the attribute for class DC.

### E. Text and properties of things

25. ⭐ **Change any description** (you asked · medium; today feats and class features only). Any record:
    spell, item, action, ancestry, condition. The card shows your text, with a "Show original" switch.
26. ⭐ **Rename or reskin** (idea · medium). "My longsword is a katana." The new name shows everywhere,
    with the book name small underneath.
27. **Change properties** (you asked · medium to hard). Traits, action cost, level, frequency, range,
    area, duration, damage, Bulk, price, runes, Hardness. Some effects are built into the app's code and
    an edit cannot change them; the editor must say so plainly.
28. **Add a note to any record** (idea · easy). Your own text under the book text, without replacing it.
29. **Save as homebrew** (idea · medium). Turn a tweaked or created thing into a homebrew record, so it
    lasts and your other characters can use it too.
43. ⭐ **Create a new thing for this character only** (you asked, decision 6 · medium to hard). A new
    feat, action, item, spell, class feature, heritage, ancestry, deity or language, or a new choice
    list. It lives
    inside the character, so it travels with exports and campaign sheets (homebrew today does not). A
    whole new class is feature 20's job; a new creature is feature 48's.

### F. Control and trust

30. ⭐ **A reason on every change** (idea · easy). "Gift from the dragon." Shown in the breakdown and in
    the list of changes.
31. ⭐ **Breakdown line on the sheet** (decision 4 · medium). "Tweak: +1 (reason)" in the breakdown of
    every tweaked number. No marks next to the numbers.
32. ⭐ **One list of all changes** (idea · easy to medium). What changed, where, the reason, on/off,
    "go to it", and remove.
33. ⭐ **On/off per change** (idea · easy). Switch a change off without deleting it.
34. **Groups** (idea · easy to medium). Name a group ("Dragon's blessing") and switch the whole group on
    or off.
35. **"Rules only" view** (idea · medium). See your character without any changes, next to the changed
    one.
36. **Copy changes to another character** (idea · medium).
37. ~~The GM sees marks and a list~~: dropped (decision 3; the GM sees tweaks in the builder only).
38. ~~The GM gives tweaks~~: dropped as a separate feature (see "Dropped ideas" 18).
39. ⭐ **The book changed under your edit** (idea · medium). After a data update, your change stays, and
    the app shows "the book text changed" with a compare view.
40. ⭐ **Broken links are shown, never dropped** (idea · easy). If a change points to something that no
    longer exists, it shows as broken, with "Remove" and "Point to another".
41. ~~"Change this" button on the sheet~~: dropped (decision 2, builder only).
42. **Warn, never block** (idea · easy). Rule-breaking picks get a small warning mark but are never
    refused.

### G. Found by the gap search (2026-10-14)

A second search looked from four sides (the sheet, the builder, the PF2e rules, the earlier research).
It found 30 candidates; a judge removed 24 that the list already covers or that do not fit your
decisions (see "Dropped ideas" below). These 6 are left. Features 44 and 45 (in section C) came just
before it.

46. ⭐ **"At least" ranks** (idea · easy · phase 1). When a tweak gives a rank, it means "at least
    trained", so your later skill increases and class raises still go up from it. "Exactly this rank"
    stays as a separate choice. This also fixes problem 10. It applies to Lore (44) and weapons (45) too.
47. ~~Follow a deity with any class~~: moved OUT of Tweaks (Guy, 2026-10-14). Today only classes that
    need a deity see the Deity card, and a fighter who takes Cleric Dedication never sees it (a bug). It
    breaks no rule, so it is a normal builder fix in its own chat (started 2026-10-14: an optional,
    closed "Deity" card for every character, never counted as a missing choice).
48. **Tweak a companion, familiar or eidolon** (in scope, Guy 2026-10-14 · medium · phase 3). "My wolf
    has resistance 5 cold." "My eidolon gets +1 to hit." Today companions have no tweak and no
    breakdown popup at all. A brand-new creature is not part of it.
49. **Rank of a spellcasting entry** (idea · easy to medium · phase 5). "My spell DC and spell attack are
    expert at level 5." It keeps going up with your class, unlike a set number (feature 2).
50. **Use a different attribute for a stat** (idea · skills easy, Strikes hard · phase 3). "I Intimidate
    with Strength." "My Sailing Lore uses Dexterity." The stat keeps following that attribute as it grows.
51. **Switch off one bonus or star from something you keep** (idea · medium to hard · phase 3). Keep the
    feat, but turn off its +1 AC, or hide a wrong star. Useful while a data error waits for a fix.

## Dropped ideas, with the reason

Every idea that came up and is NOT a feature above, so nothing disappears without a reason.

1. **Change what a night's rest or Refocus gives back.** The per-character cases (Fast Recovery, extra
   Refocus points) are feats, which feature 16 can give. "Rest heals to full" is a rule for the whole
   table: it belongs in Variant rules.
2. **Sizes of class resources and daily pools; the investiture limit; mythic points; rune and
   signature-spell limits.** Folded into feature 7 (limits) and feature 27 (runes on one item).
3. **Dying, Doomed and recovery-check limits.** Folded into feature 7. Diehard can be given with
   feature 16. "Die at Dying 5" for the whole table belongs in Variant rules.
4. **Strike rules that are not numbers (multiple attack penalty, critical specialization).** Critical
   specialization is now in feature 9. A changed multiple attack penalty for one character is too rare.
5. **Published variant rules the app has no switch for (Stamina, Point Buy, Skill Points, Level 0).**
   Rules for the whole table: they belong in the Variant rules card, not Tweaks. Kept as a backlog
   idea.
6. **A character-only heritage, ancestry, deity, background or class.** Heritage, ancestry and deity are
   now in feature 43. A custom background already exists (Deep background). A class is feature 20.
7. **Use the older printing of one record.** Goes against ruling R12: the newest printing wins, whole.
8. **A custom counter or resource.** Feature 43 covers it: a character-only item or action with uses
   (max and current) that can reset on rest. (The item editor can already make such an item, but it is
   account-wide homebrew and shows as "Unknown item" on the GM's device, because homebrew does not
   travel with a published sheet.)
9. **Change what a Mode or stance gives on this character.** Breaks decision 16 (Modes stay separate).
   Custom Modes already exist.
10. **A lasting condition that rest does not clear.** Most conditions already stay through rest. The
    leftover case (a permanent Doomed or Drained) is rare and happens in play, not in the builder.
11. **Shift the degree of success.** Folded into feature 5 (note-only change).
12. **"Only if higher" / "only if lower" set modes (from other apps).** Folded into feature 46 ("at
    least" ranks) and feature 2's "at least N" option for numbers.
13. **Temporary versus permanent changes.** Modes already do temporary changes (decision 16).
14. **The GM approves each change; the GM sees marks and a list (feature 37).** Guy chose: the GM sees
    tweaks only in the builder (decision 3).
15. **A "Change this" button on the sheet (feature 41).** Guy chose: builder only (decision 2).
16. **A deity for any class (feature 47).** Not a tweak: a normal builder fix in its own chat.
17. **A brand-new creature.** Guy chose companions in phase 3 for existing creatures only.
18. **The GM gives tweaks (feature 38).** Already possible without a new feature: the GM's edit view
    opens the player's builder (`GmEditSheet`), and a GM change goes through the player's approval (the
    never-overwrite door). A tweak made there follows the same path.

## Names

**Chosen: Tweaks** (Guy, 2026-10-14). The list below is kept for the record.

Other names that were offered:

- **House Rules**: every player knows it. But it sits next to "Variant rules" in Setup, and it usually
  means rules for the whole table, not one character.
- **Rulebender**: fun, and says "bending the rules".
- **Exceptions**: exact, a bit dry.
- **My Rules**: personal.
- **Edit Anything**: says what it does.
- **Margin Notes**: writing in the margins of the rulebook.
- **Hero's Liberties**: "taking liberties with the rules".
- **Heaven's Pen**: ties to the name Heroes Heaven.

Avoid (they clash): Adjustments (Hero Lab's name, and a PF2e item trait), Modifiers, Custom or Customize
(the app's appearance settings), Homebrew (already a section), Boons, Blessings, Banes (PF2e terms), Wish,
Miracle (PF2e spells), Forge, Hero Forge (other products).

## Questions

All answered or defaulted: see "Decisions so far". Question 17: Guy accepted the whole feature list on
2026-10-14. The original list follows for the record; my pick was first in each.

1. **Name?** Tweaks / House Rules / Rulebender / Exceptions / another.
2. **Where does it live?** In the builder, plus a "Change this" button in sheet popups that opens the same
   editor / builder only / sheet only.
3. **How do 3 or more classes combine?** Best-of, like Dual Class (best HP, best proficiencies, one class
   feat slot per class) / split levels, classic multiclass (class A at levels 1–3, class B at 4–6) /
   both.
   - Sub-question: which class gives the key attribute and class DC? Today only the first class does.
4. **What does the GM see?** The marks and the list / the GM must approve each change / nothing.
   - Approval is risky: a refused change would be the app undoing a player's change.
5. **"Set" and level-up.** A +/- keeps working at every level; a "set" number warns you at level-up when
   the book number changed / a "set" number stays frozen silently.
6. **The on/off switch in Options.** Off pauses every change, after a confirm that lists what turns off /
   off only hides the card (today) / no switch, always visible.
7. **The line with Homebrew.** A new record = Homebrew. A change to an existing record, slot, grant,
   removal or stat = the new system. Plus a "Save as homebrew" button / merge the two sections.
8. **Removing something.** Ask each time: "only this" or "this and what it gave" / always only this /
   always everything.
9. **Your text on the card.** Your text replaces the book text, with a "Show original" switch / show both /
   a note line only (today).
10. **Rename.** The new name everywhere, with the book name small underneath / the new name in lists only.
11. **Book changes under your edit.** Keep your change, flag it, offer a compare / keep it silently / drop it.
12. **Where rule-breaking happens.** Both: buttons inside each picker where the need comes up, and one
    panel that lists everything / only in the panel / only inside pickers.
13. **How your +/- stacks.** Always adds / you pick a PF2e bonus type each time.
14. **Modes.** Keep Modes separate (they are for switching in play) / merge Modes into the new system.
15. **The original rule: no "ignore all rules" switch; each rule break is chosen one by one.** Keep it /
    add an "allow anything here" setting per picker / one global "free mode" switch.
16. **Build chats.** One chat per build phase / one chat for everything.
17. **Which features?** Tell me any numbers from the feature list you do NOT want, or want later.

## Suggested build order

Each phase is one release-sized job, and each can be its own chat.

1. **Base**: the new name Tweaks; new fields inside the stored overrides, so each tweak has a reason,
   an on/off switch and a start level; move today's overrides over with nothing lost; the Tweaks panel that lists every
   tweak; the breakdown line on the sheet; +/- and "set" on the main stats. Fix problems 1, 5, 6, 7, 8,
   9 and 10 above (problems 3 and 4 are fixed in phase 3, problem 2 in phase 4).
   (Features 1, 2, 4 (start level only; "grow with level" goes with feature 3), 30–33, 40, 44, 46.)
2. **Choices**: features 10–15.
3. **Give and remove, defenses, senses, strikes, companions**: features 7–9, 16–19, 45, 48, 50, 51.
4. **Text, properties and creating things**: features 25–29, 39, 43.
5. **Spellcasting**: features 21–23, 49.
6. **More classes and class basics**: features 20, 24.

Features 3, 5, 6, 34–36 and 42 go into whichever phase touches their area. Part 2's "Phase 1 build
spec" holds the exact phase 1 rules (from the final check).

---

# Part 2 — for the build chat (code facts)

Source: a read-only research run on 2026-10-14 (5 code and research agents plus a critic), a gap search,
and a final completeness check by an independent checker. Nothing was run in the app. Spot-checked by
hand: the `BuildOverrides` shape, `overridesEnabled` read only by the UI, `grantedFeatures` display-only,
`applyOverrides` covering two buckets and skipping missing ids, the import writing `addedSpells`
(`transfer.ts`), the `override:` slot skip in `deriveBuildFromCharacter`, conditions and modes folded into
a skill before substitution (`derive.ts` `deriveSkill`), and the "Clear overrides" button (`shared.tsx`).

**Line numbers drift fast.** Other chats edit `build.ts`, `Builder.tsx` and `shared.tsx` the same day
(build.ts moved 140–250 lines within 2026-10-14). Find every place by its symbol name; use the numbers
only as a hint.

**The "Phase 1 build spec" section below is the final word for phase 1.** Where an older line in Part 2
says something different, the spec wins.

## Phase 1 build spec (final check, 2026-10-14)

1. **Stored names stay; only what the player sees is renamed.** Keep `build.overrides`,
   `Character.overrides`, `options.overridesEnabled` and the `override:<featId>` slot keys as the stored
   names forever, and put every new field INSIDE the `overrides` object (fields there round-trip for
   free). Reason: an app that is not updated yet (a party member's old version, an old APK) skips only
   `override:` rows on reopen (`deriveBuildFromCharacter`); a new `tweak:` key would steal a real feat
   slot there. `OursKind 'override'` (`cardModel.ts`) is never stored, so it can be renamed freely. An
   older app shows the old Overrides card and ignores the new fields; say so in the release notes. Add a
   guard test: no user-visible string says "override" (skip the unrelated concepts in "Rename cost").
   **The 10 existing keys keep holding their values exactly as today** (allowedFeats, addedFeats,
   addedFeatures, removedFeatIds, attributes, proficiencies, addedLanguages, addedSpells, maxHp,
   contentEdits), so an older app still shows them. Reason, on/off, start level, at least / exactly,
   the set baseline and the import stamp live in a side map such as `overrides.meta`, keyed
   `<key>:<id>`. Only new kinds (stat +/-, set, at least N) get new fields.
2. **Old characters open as before, except three intended fixes.** Every sheet number stays the same,
   except these three cases, which phase 1 changes on purpose:
   - A: a rank set to "trained" plus a later skill increase on that skill now gives the increase
     (migrated to "at least", spec 5);
   - B: a rank set LOWER than the computed rank now stays lowered after later class raises (migrated to
     "exactly", spec 5);
   - C: a set max HP now keeps a mode's max HP bonus (spec 6).
   The switch: a character with any stored overrides and no phase-1 marker reads as Tweaks switch ON
   (today's switch only hid the card; the changes were always active). This "ON by read" lasts only
   until the new version saves that character once: that save writes `options.overridesEnabled`
   explicitly plus a marker such as `overrides.v: 2`, and from then on the stored switch is obeyed.
   Import leftovers (`addedFeats` written by `deriveBuildFromCharacter` overflow, `addedSpells` written
   by the WG import in `transfer.ts`) get a `source: 'import'` stamp in `overrides.meta` from now on and
   ignore the switch. Leftovers from imports made BEFORE phase 1 cannot be told apart from the player's
   own entries: they are listed as normal tweaks, and the switch-off confirm names them. Old entries
   show in the panel as "Moved from Overrides".
3. **Migration happens at read time only.** Never rewrite `build` on load. The new shape is written on
   the player's next real Builder save. Loading must not count as an edit: no new `authoredKey`
   (`data/authored.ts`), no cloud push, no new timestamp (`rebuild.ts`, `cloudSync.ts`
   `noteDerivedRefresh`). A test proves that loading an old character changes no `authoredKey` and
   pushes nothing. Reason: cloud merge is whole-character, newest wins, so a load that stamps the
   character could wipe a newer edit from another device (the revert-incident class).
4. **One reader.** Every read of tweaks goes through one accessor (for example `activeTweaks()`) that
   applies on/off, the start level and the master switch. A guard test fails on any other direct
   `.overrides` read. Today's direct readers: the `applyOverrides` callers (`App.tsx`, `Builder.tsx`,
   `rebuild.ts`, `GmEditSheet.tsx`), `FeatsTab.tsx`, `SpellsTab.tsx`, the `allowedFeats` reads in
   `Builder.tsx`, the Free-boosts pin warning and its one-click "Clear overrides" button in `shared.tsx`
   (route it through the panel; it deletes every attribute tweak without asking today), and the
   `FullStats` lock in `shared.tsx`. Write a small table of what "paused" means for each kind. A feat
   taken through "Take anyway" stays picked when paused (the build never checks legality); only its
   warning changes. The guard test allows these direct users and no others: the writers
   (`pruneOverrides` / the Tweaks panel, the "Take anyway" patch in `Builder.tsx`, the ritual import in
   `transfer.ts`, the overflow in `deriveBuildFromCharacter`), `collectChosenIds` and
   `removeChosenIds`, the read-time migration itself, and the accessor.
5. **Ranks: "at least" and "exactly" sit in different places.** Skill increases step up from the rank
   the skill has at that moment and run BEFORE today's override loop (`buildCharacter`, the
   `build.overrides?.proficiencies` loop). So:
   - "At least" for skills and Lore: seed the floor BEFORE the skill-increase loop (the way
     `languageLores` seeds Lores), respecting the start level inside the loop. Then "at least trained"
     plus the level 3 increase gives expert. For saves, Perception, weapons and armor: apply the floor
     with `maxRank` after the class raises.
   - "Exactly": a final clamp after every raise. The skill-increase picker greys out a skill held
     exactly.
   - Migrating today's `proficiencies` entries: an entry LOWER than the computed rank becomes "exactly";
     otherwise it becomes "at least".
6. **Set and +/- order for a number.** Book total → "set" replaces it, or "at least N" raises it to N →
   tweak +/- adds → conditions, modes and Drained apply on top → a battle form replaces the whole number,
   as today's `deriveAc` does; tweak +/- do not apply during a battle form.
   Today's code folds conditions and modes into a skill before substitution, so a "set" placed after
   substitution would wipe them (AC set to 20 must still drop when off-guard). Today's max HP set keeps
   Drained but drops a mode's max HP bonus; the same order fixes that.
7. **Breakdown wording.** A +/- shows "Tweak: +1 (reason)". A set shows "Tweak: set to 20 (reason)"
   and "at least N" shows "Tweak: at least 30 (reason)"; both carry the difference, so a guard test can prove the breakdown parts sum to the total (set
   included). A set stores the book number at the time it was made, so decision 9 can warn at level-up
   when the book number changed; a migrated set gets its baseline at the first real save.
8. **The main stats for phase 1.** Attribute scores (a +/- changes the score, never a mode shift, so the
   ~9 readers that bypass `abilityModOf` stay right), max HP, AC, the 3 saves, Perception, every skill
   and Lore, class DC, Initiative, spell attack and spell DC per casting entry, land Speed. Strikes wait
   for phase 3.
9. **Start level is checked against the level being viewed** in the Builder. Today `baseSkills`
   (`Builder.tsx`) calls `buildCharacter` at `build.level` with every override. Make it count only
   tweaks whose start level is at or below the level being viewed, so a tweak "from level 5" does not
   show while picking the level 3 increase. Phase 1 builds the start level only; "grow with level"
   (the rest of feature 4: "+1 more at levels 5, 10 and 15", "half your level") goes with feature 3 in
   a later phase.
10. **Problem 6 in phase 1** = remove the `f.level <= build.level` filter in the grant picker
    (`shared.tsx`).
11. **Lore (feature 44)** uses the one keyer `loreKey` (`build.ts`), so a "Sailing Lore" tweak and a
    background's Sailing Lore are one row, and the skill-increase picker offers it.
12. **Deleting a tweak in the panel is not "removing a thing"** (decision 7): it asks nothing.
13. **Consider the Modes machinery for +/-.** `modes.ts` already has untyped and typed +/-, note-only
    entries (`appliesWhen`), breakdown lines (`modeAdjust`), a target list with Lores
    (`modeTargetOptions`), and resistances, senses, speeds and strikes. Storing +/- tweaks in the
    `ModeModifier` shape and feeding them in at ONE point that the sheet, the party card and the
    tracker all pass through may beat adding a new term at 8+ derive sites. Decide after reading
    `modes.ts`. Tweaks must stay out of the "a mode moved this number" highlight (decision 4: no marks),
    and Modes stay a separate system for the player (decision 16).
14. **Tests phase 1 must add:**
    - migration: the `SAMPLE` in `test/overrides-write.test.tsx` plus import-leftover rows, switch
      unset → every sheet number equal before and after, except cases A, B and C of spec 2, which are
      pinned by their own tests;
    - the "ON by read" switch: ON before the first new-version save, obeyed after it;
    - problem 10 and problem 5 cases ("at least trained" + increase → expert; "exactly" holds after a
      later raise);
    - pause and resume for each kind;
    - a missing id is shown and can be removed;
    - the breakdown sums to the total, set included;
    - the tracker row (`test/bug-tracker-pc-row-agrees.test.tsx`) and the party card show the tweaked
      numbers;
    - loading an old character is not an edit;
    - no user-visible "override" string.

## Today's model

- `BuildOverrides` at `src/rules/types.ts:6129-6161`, 10 keys: allowedFeats, addedFeats, addedFeatures,
  removedFeatIds, attributes, proficiencies, addedLanguages, addedSpells, maxHp, contentEdits{feats,
  classFeatures}. On `BuildState.overrides` (`build.ts:118`), emitted whole on `Character.overrides`
  (`build.ts:9708`), deep-cloned back in `deriveBuildFromCharacter` (`:10086`).
- UI: `OverridesCard` `src/builder/shared.tsx:2957-3230`, mounted at `Builder.tsx:1903` only when
  `options.overridesEnabled` (`types.ts:6117`; toggle `shared.tsx:3283-3291`). Writes through
  `pruneOverrides` (`shared.tsx:2938`). "Take anyway": `Builder.tsx:3549-3658`.
- `build.ts` never reads `overridesEnabled` (grep: only `shared.tsx:3286-3287`, `Builder.tsx:1903, 3553`).
- Where the engine reads each key: attributes `build.ts:3885`; proficiencies `:5788`; addedFeats `:5990`
  (also `:4704`, `:4790`, `:2847`); removedFeatIds `:6492`; addedSpells `:9240-9264` (innate entry
  `added-spells`; rituals read at `SpellsTab.tsx:1526`); addedLanguages `:9866`; maxHp `:9730`
  (`derive.ts:912` returns early); addedFeatures `:9536-9555` → `Character.grantedFeatures`, read only by
  `FeatsTab.tsx:373` (`derive.ts:3791` says "a display list nothing derives from"; `ownedFeatureIds`
  `derive.ts:3757` does not read it).
- `applyOverrides` `build.ts:3313-3330`: shallow whole-value overlay of feats and classFeatures only;
  missing ids skipped silently. Callers: `App.tsx:1108, 1362`, `Builder.tsx:313`, `rebuild.ts:47`,
  `GmEditSheet.tsx:173, 203`. Raw (un-overlaid) content still feeds `applyPlayState` and the party summary
  (`App.tsx:1094, 547`) and the tracker's `computePcStats.ts`.
- Tests: `test/overrides.test.ts`, `test/add-spell-override.test.ts`, `test/overrides-write.test.tsx`
  (`:31-58` fails when a new key has no sample), `test/bug-builder-roundtrip.test.ts:231`.

## Sheet markers today

- Only three: the HP breakdown line "Manual maximum (override)" (`explain.ts:1520-1525`), the "ours" line
  "Your override: …" (`FeatsTab.tsx:176-185`, `OursKind 'override'` in `cardModel.ts:112, 123`), and the
  "Added spells" entry name.
- The record card draws the Archives page when one exists (RecordCard; `DescBody.tsx:36-41` is the
  no-page lane). About 99.6% of feats and 82% of class features have a page, so description edits are
  mostly invisible. A name edit is not drawn on the card (`FeatDetail.tsx:278-280`).
- Gold-set Q3 (`docs/gold-set-answers.md:50`): a replacing change must "make plain … what changed".

## Stat pipeline (for features 1–9)

- Typed modifiers are pooled at `derive.ts:254, 450, 643, 678, 877/885, 2088, 4786, 5125` and
  `initiative.ts:59`. A new always-on build-time term must be added at each site, with a matching
  `explain.ts` part (`CalcPart.note`, `explain.ts:110-147`).
- `resolveFormula` clamps to ≥ 0 (`derive.ts:2445`): never route penalties through it.
- SUPERSEDED by the Phase 1 build spec, item 6 (the set order). Setting Perception also moves Initiative
  (`initiative.ts:59-70`).
- About nine readers bypass `abilityModOf` (e.g. `MainTab.tsx:1323`, `VitalsRail.tsx:348`,
  `explain.ts:1061`). Write attribute +/- as a score change, or route every reader through
  `abilityModOf`.
- Breakdown and total already drift (AC runes, HP mode, ability mode shifts). Add one guard test that the
  breakdown parts sum to the total.
- Modes: `ModeDef` `types.ts:4885` (engine fields `:4909-4990`: resistances, senses, speeds, strikes,
  slot bonus, battleForm), targets `modes.ts:18-33`, untyped sum `:197`, editor `ModesPanel.tsx:367-476`,
  stored on the device (`storage.ts:443-480`), not in the character export.
- Situational: a per-character note needs an owned-id branch in `characterSituationalIds`
  (`explain.ts:284-361`); synthetic keys are ignored (`:373-375`). `src/rules/situationalBonuses.ts` is
  GENERATED: never write per-character notes there.
- Removing a sense, resistance or speed has one precedent only: `removesWeaknesses` (`derive.ts:3080-3093`).

## Selections (features 10–15)

- `levelGrants` `build.ts:10991-11100` makes every level's slots. Five callers: `Builder.tsx:2065`,
  `build.ts:1088, 1189, 10665`, `featSlots.ts:54`. The last two do not pass `build`, so slot changes read
  from the build are invisible there until both change.
- Slot keys are positions (`level:category:idx`, `Builder.tsx:2533`). `rekeyFeatSlots`
  (`featSlots.ts:218`) re-keys every per-slot map listed in `SLOT_KEYED` (`featSlots.ts:65`): any new
  per-slot flag must be added there.
- `buildCharacter` honours any well-formed `featPicks` key (`build.ts:5957-5971`). Picks under a key no
  slot draws show as "feat with no slot" rows (`Builder.tsx:3042-3067`).
- Filters: `slotTakes` (`featSlots.ts:342`) and `fitsSlot` (`:135`). The hidden-match footer
  (`Builder.tsx:3452-3477`, `findHiddenFeatMatches` `featSlots.ts:546`) reports "N not valid for this
  slot" with no action: the natural home for "Allow here".
- Boost count is capped in four places (`build.ts:1530-1533, 1101`; `Builder.tsx:3286, 3310`;
  `shared.tsx:854`) plus a literal "4" (`shared.tsx:5106`). Class-feature picks: `extraPickCount`
  (`build.ts:1004`) with the counter hook `applyCounterMods` (`:1017`). `levelChoices`
  (`build.ts:1047-1138`) counts choices left and must learn any new slot kind.
- Choice resolvers discard out-of-list answers (`featSkillChoiceValue` returns `opts[0]`,
  `build.ts:2054-2057`); bound answers have no picker (`:2083, 2132`). Options come from
  `buildChoiceOptions` (`build.ts:2245`) and `effectiveChoiceOptions` (`derive.ts:1637`).
- `checkPrerequisites` (`build.ts:11209`) sees `classId` only (`:11233-11237`).

## Give and remove (features 16–19)

- Give feat cap: `f.level <= build.level` (`shared.tsx:2989`).
- Lore (feature 44): the engine already routes `lore:<subject>` proficiency keys to skills
  (`build.ts:5788`), and `profTrackName` names them (`shared.tsx:2497`). The UI list
  `profTrackOptions` (`shared.tsx:3020-3023`) offers only `PROF_TRACKS` + `SKILLS`, so no Lore can be
  added. The builder already has a "type your own" Lore field to reuse (`shared.tsx:1511`, heritage Lore
  inputs at `:3695-3711`).
- `removedFeatIds` is a late splice (`build.ts:6492`) after the removed feat's grants are pushed
  (`:6233-6464`); the focus pool is computed before it (`:4704-4790`).
- The proficiency override (`build.ts:5850-5860` on 2026-10-14; it was `:5788` earlier the same day)
  sets ranks outright. It runs AFTER skill increases (`build.ts:4458`, made into `proficiencies.skills`
  at `:4468`), so it wipes a later increase on the same skill (problem 10). It runs BEFORE later
  `maxRank` raises (`:6591-6594, 7054-7064, 7909`), so a lowered rank can come back (problem 5).
  Do NOT simply make it a final clamp: that would wipe every later raise too. Split it (feature 46);
  WHERE each half goes is in the Phase 1 build spec, item 5 (the "at least" floor for skills must be
  seeded BEFORE the skill-increase loop, or the increase still lands on trained).
- Spellcasting entry rank (feature 49): `PROF_TRACKS` (`shared.tsx:2481-2495`) has no spell track, and
  the override loop sends unknown keys to `proficiencies.skills` (`build.ts:5859`), so a spell key would
  become a fake skill. Apply an entry-rank tweak after `entryRetune`.
- Attribute swap (feature 50): `SKILL_ABILITY` and `SAVE_ABILITY` are fixed maps (`derive.ts:126-149`),
  every Lore uses Int (`:154-156`), and `skillAbilitySwapFor` (`:594-609`) reads only owned feats and
  class features; `deriveSkill` already takes the best of two attributes (`:634-640`).
- Switch off one bonus (feature 51): `TypedMod` has no source id (`modes.ts:168-171`), and
  `poolTypedMods` keeps the best per type (`:191-201`), so an opposite-number tweak goes wrong with
  typed stacking. Every pool site and its `explain.ts` part must carry a source id first.
- Companions (feature 48): `CompanionConfig` (`types.ts:5260-5297`) and `EidolonConfig`
  (`:5233-5258`) have no bonus field; the companion derive functions (`companions.ts:354, 709, 927`) add
  only gear, conditions and `modeNumberBonus`; `CompanionsTab.tsx` has no breakdown popup.
- Deity (feature 47): the Deity card shows only when `buildUsesDeity` is true (`shared.tsx:4753`,
  `build.ts:2585-2632`); Cleric Dedication has only a sanctification choice, so it never shows the card.
- Limits the sheet blocks on (feature 7): `character.investedLimit` (`InventoryTab.tsx:530-533`),
  `MAX_MYTHIC_POINTS = 3` (`play.ts:27`), the Prepare button cap (`MainTab.tsx:1625`).

## Classes and spellcasting (features 20–24)

- Dual class: `classId2`, `subclassId2` (`build.ts:143-144`), spell trio `cantrips2/spells2/signatures2`
  (`:347-349`). `heldClasses` (`derive.ts:3683`, about 11 callers) is the shared seam, beside about 14
  hand-written `cls2 = dualClass && classId2` constructions and pair literals. `entryClassIdOf`
  (`derive.ts:3703`) knows index 1 only. 126 test references.
- Key attribute and class DC: first class only (`build.ts:4039`, `derive.ts:674`). HP: max of the two
  (`derive.ts:916-922`). Proficiencies best-of (`build.ts:4437-4445, 5723-5730`). Second-class
  spellcasting is a hand-copied block (`:5319-5390`); the focus pool picks one class (`:5487`).
- Entry ids are already class-prefixed (`${classId}-casting`), which suits N classes.
- `SpellcastingEntry` `types.ts:5822`; class profile `ClassSpellcasting` `types.ts:3956-4006`;
  `casterSlots` `spellcasting.ts:159`; `cantripsKnown(classId)` `spellcasting.ts:19` is keyed by class
  id. Entry creators are all inside `buildCharacter`; `entryRetune` runs last (`build.ts:9273`). No
  "remove spellcasting" mechanism exists.

## Records (features 25–29)

- Mechanics keyed by id in code tables cannot be patched through record fields
  (`docs/trust-gate.md:198-208`). The trust doc calls Overrides "the escape hatch" (`:213-216`); no code
  clears the trust marker for an edited record.
- Item editor copy-on-write (`ItemEditorModal.tsx:610-690`) makes global copies with no source id and
  drops eight fields; on a GM's device they show as "Unknown item" (`InventoryTab.tsx:609-640`).
- Homebrew (`storage.ts:175-198`) has no per-entry timestamp; its cloud merge is a union, local wins
  (`cloudMerge.ts:12-14, 55-61`). Homebrew definitions do not travel with a published sheet
  (`App.tsx:551`).

## Data safety (applies to every phase)

- A player's change must never be overwritten by the app. Builder Save replaces `build` wholesale from
  the snapshot the Builder opened with (`App.tsx:1373-1383`): a change made on the sheet while the
  Builder is open would be wiped. Cloud merge is whole-character, newest wins (`cloudMerge.ts:69-107`).
  Timers: persist 400 ms (`data/persist.ts:22`), push 3 s (`cloudSync.ts:75`). A rebuild drops play
  inventory (`playForRebuild`, `play.ts`).
- GM edits: a GM push is judged by `authoredKey`, which includes `build` (`data/authored.ts:32-37`;
  `gmSync.ts:122-145`).
- Dangling ids are skipped silently today (`build.ts:3321, 3326, 5991, 9240, 9538`); a `contentEdits`
  entry for a missing id is counted but has no row (`shared.tsx:3210-3214`). UNKNOWN ≠ EMPTY: show
  broken entries, never drop them.
- Every key holding content ids must be added to `collectChosenIds` and `removeChosenIds`
  (`build.ts:3401-3404, 3532-3538`); `contentEdits` ids are missing there today.
- `normalizeCharacter` passes `overrides` through unvalidated (`normalize.ts:107-153`).
- The round-trip trap: a granted or extra-slot pick must never use up a real slot on reopen. Today
  `override:<featId>` keys are skipped at `build.ts:10645`. New fields inside the overrides object
  round-trip for free; a new top-level `BuildState` field needs explicit emit and restore (like
  `build.ts:9721` and `:10113`).
- Import residue: derive overflow writes `overrides.addedFeats` (`build.ts:10744-10753`); the WG ritual
  import writes `overrides.addedSpells` (`transfer.ts:1054`). Split user intent from residue.
- Export: native `.codex.json` and campaign publish keep overrides; WG v4 export does not.

## Rename cost

- DECIDED (Phase 1 build spec, item 1): the stored names stay (`build.overrides`, `Character.overrides`,
  `options.overridesEnabled`, the `override:<featId>` slot keys), so no read alias and no migration of
  key names. Schema version is 1 with no migrations (`types.ts` `CHARACTER_SCHEMA_VERSION`,
  `normalize.ts`). Only user-visible text, component names and CSS may be renamed.
- About 85 source hits in 13 files, about 119 test hits in 28 files, 36 CSS hits (`builder.css`
  `ovr-*`, `attr-override-*`, `picker-override-note`). Renaming internal identifiers is optional;
  user-visible strings are listed in the first research report (labels in `shared.tsx`, `Builder.tsx`,
  `FeatsTab.tsx`, `explain.ts` "Manual maximum (override)").
- Do NOT rename these different concepts: `carryStoredOverrides`, `hitPoints.maxOverride`,
  `speedOverride`, `weaponOverrides` / `armorOverrides`, `sizeOverride`, the customization override, the
  tracker's own `overrides`, the AST `override-title-right` key.

## Lessons from other apps (ideas only)

- A "set" value stayed frozen after level-up (D&D Beyond); a max HP override was wiped by a rest; typing
  0 in an override box did not mean "empty"; DMs had no change log; the phone app lacked the customize
  menu; Foundry grants applied only once, so later edits never reached existing characters; copies of
  book records fell behind errata.
- Wanderer's Guide is GPL-3.0: ideas only, never its text, code, data or operation names.

---

# Part 3 — build prompts

## Phase 1 (Base)

Paste this into a new chat started in `C:\trying ai 2\pf2e codex`:

```text
Build phase 1 of Tweaks in Heroes Heaven. Tweaks is the redesign and new name of the per-character
"Overrides" card in the Builder. The design is finished and Guy accepted it on 2026-10-14.

Read first, in this order:
1. docs/overrides-redesign.md — Part 1 (Guy's decisions are final), then Part 2's "Phase 1 build spec"
   (the exact phase 1 rules; it wins over any older line in Part 2). Line numbers in Part 2 drift: find
   code by symbol name.
2. docs/gold-set-answers.md, as the repo's CLAUDE.md requires before touching anything the sheet shows.
3. The memory note project_hh_tweaks_design_2026_10_14.md.

Phase 1 scope (features 1, 2, 4, 30-33, 40, 44, 46; problems 1, 5, 6, 7, 8, 9, 10):
- The player sees "Tweaks" everywhere the old card said "Overrides". The stored names stay
  (spec item 1).
- Each tweak has a reason, an on/off switch and a start level (phase 1 builds the start level only, not
  "grow with level"). The Tweaks switch in Options pauses every tweak, after a confirm that lists what
  turns off.
- Old characters open as before, with nothing lost; every number stays the same except the three
  intended fixes A, B and C (spec item 2). Migration happens at read time only, and loading is never an
  edit (spec items 2 and 3). The 10 existing stored keys keep their values (spec item 1).
- The Tweaks panel in the Builder lists every tweak: what, where, reason, on/off, go to it, delete.
- +/- and "set" (with an "at least N" option) on the main stats listed in spec item 8, in the order of
  spec item 6, each shown in the stat's breakdown as "Tweak: ..." (spec item 7). No marks next to
  numbers.
- Ranks: "at least" by default, "exactly" as a choice (spec item 5). Add a Lore with any subject. Give
  feats of any level.
- A tweak that points to something missing is shown with Remove and Point to another, never dropped.
- NOT in phase 1: everything else in the feature list (phases 2-6).

How to work:
- Start with the look. Show Guy one small sample of the Tweaks panel in the real Builder, at desktop and
  phone width, next to the existing Setup cards. Ask the taste questions before you build the rest.
- Before you edit build.ts, shared.tsx or Builder.tsx: ask Guy in one line whether the "Deity for every
  class" chat has finished and committed (it edited those files on 2026-10-14). Run `git status`, and
  never overwrite uncommitted edits in those files. Two writers on the same files lose work.
- This touches saving and Guy's characters: follow the effort ladder at level 3 or higher, and end every
  build loop on a checker.
- Add the tests in spec item 14 as you build each part. Run tests only through `scripts/vt.mjs`.
- Test like a user in the browser preview (dev-skip login, test characters only): build a test character
  with today's Overrides first, then check it opens with every change kept and the same sheet numbers,
  except cases A, B and C of spec item 2.
- Commit locally by file name. Do not push.
- At the end, update the doc's status line and "Decisions so far", update the memory note, and tell
  Guy that phase 2 (Choices) is next.
```
