# Heroes Heaven — read this before you act

This file loads automatically. It exists because sessions kept starting work without the context that
decides whether the work is right, and then had to be undone.

## ⛔ BEFORE touching feats, items, or anything the sheet displays

**Read `docs/gold-set-answers.md` first, in full.** It holds the owner's own rulings — 19 numbered
decisions and 16 lettered principles, quoted in their words, not paraphrased. It is the authority.
Where it settles something, it is settled, and building against it wastes the work.

The single most expensive mistake made here was not knowing those rulings existed. A run once proposed
108 "missing systems"; adversarial pruning killed 106, and **85 of them because a ruling or an existing
lane already covered it.** Reading one file first would have prevented all of it.

Then, as the task needs:

| file | what it settles |
|---|---|
| `docs/gold-set-answers.md` | **the authority.** Owner rulings + principles |
| `docs/mechanic-lanes.md` | the 68 lanes, and **DECIDED SCOPE** — what deliberately does NOT belong on the sheet |
| `docs/feat-text-audit-spec.md` | the feat audit. Opens with a **▶ RESUME HERE** section |
| `work/rulings/DECISIONS.md`, `DECISIONS-round2.md` | the original situational-bonus rulings A–O |
| `MIGRATION.md` | the AoN data migration; has its own resume point |

**Ally-facing effects are the trap.** Ruling F removes the *number* from your sheet. It does **not**
remove the player's need to SEE that their own ability was modified — an ally-facing feat still needs a
marker on the record it changes. Getting this backwards invalidated six control feats once.

## ⚠ Traps that have each cost real time

- **`buildCharacter` does NOT return the sheet.** It returns the stored character. Senses, AC,
  resistances, speeds, strikes and situational notes are computed by `derive.ts` and appear nowhere on
  it. Diffing the stored object once reported "changes nothing" for 18 of 20 feats.
- **`scripts/data/effect-backfill.json` is the ONLY overlay that survives `npm run data`.** Anything
  written straight into `public/core.json` dies at the next regeneration. Run
  `node scripts/import-siege-and-gaps.mjs` after editing it.
- **`public/core.json` must stay MINIFIED**, and descriptions live in `public/core-descriptions.json`.
  Any script reading core.json BY TEXT must merge them back first.
- **`npx jiti`, not `node`,** for scripts importing `.ts`. jiti cannot parse `.tsx` — inline what you
  need instead.
- **`tsc -b` lies** (it is incremental). Use `npx tsc --noEmit`.
- **Search record fields at ANY depth.** A shallow top-level check once called two records empty whose
  mechanics live inside `effectChoices[].grant`.
- **Foundry's silence means nothing.** 3,537 feats exist there with zero rule elements; only 39% carry
  usable mechanics. Its `ItemAlteration`, `ActiveEffectLike` and `RollOption` are mostly VTT plumbing —
  never quote their counts as gaps. Its prose is never a source; specification comes from our own text.

## Working agreements with the owner

- **Verify in the browser preview.** Do not assert that a change works — show it. A duplicate row on
  the Details tab was caught this way and would otherwise have shipped.
- **Never rebuild the Tauri exe** unless asked.
- **Never improvise when a referenced file is missing** — ask for the real one.
- **Every sheet description popup needs the favourite star** (reuse `PinStar`).
- **Test characters are disposable.** Change them freely; do not narrate doing so.
- ⛔ **NEVER `git add -A` or `git add <dir>`.** The owner keeps substantial uncommitted work in this
  tree. Stage files BY NAME, only the ones you touched. This was got wrong twice in one session and
  both commits had to be undone.
- Commit messages: explain WHY, and say what was measured rather than what was attempted.

## State of the feat audit

Four lanes built and tested: creature traits, degree-of-success, battle forms, the formula book.
The frozen 500 (`scripts/audit/feat-500.json`, seed 20260808 — **never redraw**) has been audited on
Opus: 136 correct, 342 defect candidates, 22 uncertain since resolved.

**The 342 are CANDIDATES, not confirmed defects.** No verification pass has run on them. The last claim
pile went 27 → 14 under scrutiny. Do not fix from that list without verifying first: a false gap sends
you to rebuild something that already works, which happened with a "⚠ VERIFIED GAP" that was flatly
wrong — the code shipped at `featGrantsAuto.ts:23` all along.
