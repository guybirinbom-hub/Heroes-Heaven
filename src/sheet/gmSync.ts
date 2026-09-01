/*
 * The one rule that decides whether a GM's unsaved work survives a player's edit.
 *
 * The GM's sheet holds a WORKING COPY. The player's published sheet arrives live underneath it. Which
 * of the two wins is the whole conflict model, so it lives here as a pure function with tests rather
 * than as a condition buried in an effect.
 */

/** What the GM's editor should do with a newly published version of the player's sheet. */
export type GmReconcile =
  /** The two already match — usually our own push echoing back. Nothing to do. */
  | 'in-step'
  /** No unsaved GM edits, so take the player's version silently. This is the seamless case. */
  | 'adopt'
  /** The GM has unsaved edits. Keep them and flag the newer version — never overwrite work in progress. */
  | 'hold';

export function reconcileGmWork(args: { live: string; work: string; dirty: boolean }): GmReconcile {
  if (args.live === args.work) return 'in-step';
  return args.dirty ? 'hold' : 'adopt';
}

/**
 * Did an incoming GM edit just replace local work the player hadn't published yet?
 *
 * `lastPublished` is what this device last sent to the party. If the sheet on screen has moved on from
 * that, the GM was necessarily editing a version without those changes, and applying their edit drops
 * them. Not a reason to refuse the edit — last change wins — but it IS a reason to say so, because a
 * change disappearing with no explanation is the one thing a player can't recover from on their own.
 *
 * Unknown `lastPublished` (nothing published yet this session) counts as "no loss to report": we can't
 * tell, and crying wolf on every GM edit would train the player to ignore the banner.
 */
export function playerWorkWasOverwritten(lastPublished: string | undefined, localNow: string): boolean {
  return !!lastPublished && lastPublished !== localNow;
}

/**
 * Which fetched GM edits are NEW to this device — strictly newer than the stamp of the last edit
 * applied for the same (campaign, character).
 *
 * The stamp exists because the cleanup DELETE on `gm_character_edits` is best-effort: on a database
 * missing the `gce_owner_delete` policy it "succeeds" while removing NOTHING, and the surviving row
 * was then re-applied on every poll tick (2.5 s) — the player's sheet rewound to the GM's stale copy
 * seconds after every local change, inventory moves included, with no error anywhere. Filtering by
 * stamp makes that loop structurally impossible: however long a row lingers, it applies exactly once.
 *
 * A missing/empty `updatedAt` on a fetched edit compares as '' and is filtered once any stamp exists
 * for its key; with no stamp it is skipped too — a row with no timestamp cannot prove it is new.
 */
export function editsToApply<E extends { campaignId: string; charId: string; updatedAt?: string }>(
  edits: E[],
  appliedStamps: Record<string, string>,
): E[] {
  return edits.filter((e) => (appliedStamps[`${e.campaignId}|${e.charId}`] ?? '') < (e.updatedAt || ''));
}
