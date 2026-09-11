# Trust gate — decisions taken after step 1 (2026-09-10 evening)

These settle the open questions the step-1 verifiers raised. They bind steps 2–5. Where a decision changes
the generator, the ledger is regenerated and the census re-printed; the ledger is deterministic, so the
change shows up as a diff.

1. **A path stays ON if ANY of its kinds is WG-encoded on that record** (not all of them). `innateSpells` maps
   to `spellcasting` + `spell`; a WG row that encodes only `spell` still encodes the innate spell, so the
   field stays. Same for `focusSpells` (spell + focus), `focusPoolBonus` (spellcasting + focus),
   `derivedGrant` (grantsRecord + conditional). This is the reading the directive means by "implemented the
   same as them". Expect the fully-dark count to drop from 2,244 and the aeon stones' spells to stay on.
2. **The `featGrants` lane is per kind.** `lanes.featGrants` becomes `{ "<id>": ["skill","save",...] }` —
   the registry KINDS that are OFF for that carrier (the kinds a FEAT_GRANTS entry delivers are the
   FEATGRANT_KEY_KINDS in `scripts/wg-diff.mjs` ~838-846). The generator scrapes ALL three tables the registry
   is spread over (`src/rules/featGrants.ts#FEAT_GRANTS` plus the two generated files it spreads in — find
   them from the `...` spreads at the FEAT_GRANTS definition). The runtime helper `grantsFor(id)` returns the
   entry with the OFF kinds removed; an entry with every kind off returns undefined. Widening the scrape must
   NOT darken a record WG encodes — that is exactly what per-kind achieves.
3. **`hp` (a shield's Hit Points) and `attackItemBonus` (a bomb's printed attack bonus) stay OUT of the
   strippable universe.** They are item chassis, the same family as `hardness` and `acBonus`. Confirmed.
4. **The §5 completeness guard reads: every path `fieldToKinds` knows, EXCEPT `OUR_KINDS._noCounterpart`,
   is in `trust-fields.json` (as a path or under `_excluded`).** `degreeShifts` is the case that made the
   wording matter.
5. **Approvals may name paths that no record carries yet** (the desk fixes create them: e.g.
   `choice.options[].grant.grantsFeats`, `enhancement.grant.resistances`,
   `effectChoices[].options[].grant.grantedStrikes`). The §5 check "every approvals entry names real paths"
   means "a real field on that record OR a path in trust-fields OR a pending record". After the desk-fix batch
   lands, `trust-fields.json` is re-seeded and the guard re-run — that is a named step of the desk-fix batch.
6. **#145 (the spider Web attack) stays in the `engine` list** of the approvals file; the new strike lands on
   `classFeatures/animal-instinct.grantedStrikes`, whose `weapon` kind WG already encodes.
7. **Chassis-bucket approvals (reborn-soul, northridge-scholar, magus, summoner) stay** even though the
   chassis buckets are all-on today; they survive a policy change.
8. **The `--batched-only` question and the tracked-ledger question are the owner's** and are still open. Build
   everything so that both answers are one flag / one `git add` away: the runtime reads whichever ledger file
   is at `src/data/trust-ledger.json`; the generator's default stays as the plan says until he answers.
9. **Delete the stray duplicate `work/.trust-ledger-batched.json`** (byte-identical to
   `work/.trust-ledger-batched-only.json`).
