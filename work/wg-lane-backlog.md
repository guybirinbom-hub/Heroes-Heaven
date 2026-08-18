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
