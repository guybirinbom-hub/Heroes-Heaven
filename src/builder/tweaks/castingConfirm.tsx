/*
 * B16 — "This changes <entry>": the question the Builder's Save asks before it stores a build that changes
 * a spellcasting entry (plan B WP4, open point 8; work/tweaks-part-b-notes/plan.md section 1 "WP4").
 *
 * The changes come from blocks/save.ts `castingEntryChanges` (a type change, a prepared entry left with no
 * slots, a smaller repertoire or cantrip count, an entry gone) — whatever made them: a feat picked in a slot,
 * a feat given through Tweaks, a given feat paused, or Tweaks switched off. The spells the player prepared or
 * chose are never deleted by a Save (rules/play.ts `playForRebuild` keeps every key; pinned by
 * test/tweaks-casting-confirm.test.tsx), so the dialog says they come back when the change is undone.
 */
import { confirmDialog } from '../../sheet/confirm';
import type { CastingChange } from '../../rules/blocks/save';

/** Ask before a Save that changes casting entries. Resolves true to save ("Save anyway"), false to go back
 *  ("Keep editing", Escape, the X). No changes: true, without a dialog. */
export function confirmCastingChanges(changes: readonly CastingChange[]): Promise<boolean> {
  if (!changes.length) return Promise.resolve(true);
  const title = changes.length === 1 ? `This changes ${changes[0].name}` : `This changes ${changes.length} spellcasting entries`;
  return confirmDialog({
    title,
    message: (
      <>
        <ul className="casting-changes" style={{ margin: '6px 0 0', paddingLeft: 20 }}>
          {changes.map((c) => (
            <li key={c.id}>
              <strong>{c.name}</strong>: {c.what.join('; ')}
            </li>
          ))}
        </ul>
        <p style={{ marginTop: 8 }}>Spells you prepared or chose for it stay saved, and come back if the change is undone.</p>
      </>
    ),
    confirmLabel: 'Save anyway',
    cancelLabel: 'Keep editing',
  });
}
