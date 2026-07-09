# §13 — Ancestry / heritage / background data vs Foundry

**Status:** ✅ done (2026-07-09) · **Confirmed findings: 7** (0 crit · 1 high · 3 medium · 3 low)
_(10 raw confirmations dedupe to 7 — Gold Falls Regular was flagged 4×.)_

**Verified CORRECT:** ancestry **size**, **senses/vision** (darkvision/low-light), and **languages**; background
**attribute boosts** (all match Foundry); ancestry HP/speed (from §2) and boosts/flaws (from §9). The issues are
one background-skill typo and a set of heritage-grant omissions for less-common grant types.

---

## 13.1 — [HIGH] "Gold Falls Regular" background trains Acrobatics, should be Performance

- **Where:** `public/core.json → backgrounds['gold-falls-regular'].trainedSkill = "acrobatics"` (correct:
  **"performance"**).
- **Defect:** the structured `trainedSkill` field is wrong and even **contradicts the background's own
  description** ("You're trained in the Performance skill") and its granted feat **Impressive Performance** (a
  Performance feat). Foundry: `system.trainedSkills.value = ["performance"]`. A diff of all shared backgrounds
  found this as the **only** trained-skill mismatch — an isolated copy/paste typo.
- **Failing example:** choosing this background trains Acrobatics, contradicting the text on the same screen and
  leaving Impressive Performance without matching skill training.
- **Fix:** set `trainedSkill = "performance"`.

## Heritage-grant omissions — the app models fixed grants but misses these grant *types*
The app's heritage model handles fixed grants (17 brawling unarmed strikes, fixed resistances). These grant
types are unmodeled:

- **13.2 — [MEDIUM] Spined Azarketi:** missing the **spine ranged unarmed attack** (1d4 poison, range 10, dart
  group). `grantedStrikes` undefined (all 9 azarketi heritages). The `grantedStrikes` schema supports it (used
  by 17 other heritages) — a data omission. → a Spined Azarketi has no spine attack on their strikes.
- **13.3 — [MEDIUM] Deep Fetchling:** missing the **chosen cold-or-void resistance = half level**. The app
  models fixed heritage resistances but not choice-based ones (`resistances` absent).
- **13.4 — [MEDIUM] Elementheart Kobold:** missing the **chosen elemental resistance = half level** (element
  determines the type). Same choice-based-resistance gap as 13.3.
- **13.5 — [LOW] Dhampir:** missing **negative healing** (healed by void, harmed by vitality). No
  `negativeHealing` field exists on any heritage.
- **13.6 — [LOW] Nephilim-type versatile heritages (8: Nephilim, Dhampir, Duskwalker, Ardande, Changeling,
  Oread, Suli, Sylph):** grant low-light vision **and upgrade it to darkvision if you already have low-light** —
  the conditional darkvision upgrade isn't modeled.
- **13.7 — [LOW] Warrior Automaton / Warrior Jotunborn:** increase the **fist damage die 1d4 → 1d6** (and drop
  the nonlethal penalty); not modeled (only Monk Powerful Fist upgrades the fist die in the app).

- **Fix (cluster):** extend the heritage model to support choice-based resistances (13.3/13.4), a ranged
  `grantedStrike` (13.2), `negativeHealing` (13.5), a conditional low-light→darkvision upgrade (13.6), and a
  fist-die upgrade (13.7). Individually low/medium impact; collectively a "heritage grant coverage" task.
