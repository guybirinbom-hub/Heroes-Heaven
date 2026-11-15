/*
 * The Tweaks button in the Builder's top bar (decision 26; plan B section 4.1, WP6). Shown only while Tweaks
 * is on in Setup → Options (decision 28, `tweaksPageOn`). Its count is every listed row — live, paused, broken
 * and newer-version (B12); the dot says something on the page needs a look (a set whose book number changed;
 * WP8 adds a given feat's unanswered question). Not a level chip: the strip stays as it is.
 * On a phone it sits in the header's second row as icon + count (the word is hidden at ≤ 400 px and kept in
 * the aria-label) — builder.css "Tweaks" block.
 */
export function TweaksButton({ count, dot, open, onToggle }: { count: number; dot: boolean; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={'b-tweaks' + (open ? ' on' : '') + (dot ? ' has-dot' : '')}
      aria-pressed={open}
      aria-label={`Tweaks, ${count}${dot ? ', one needs a look' : ''}`}
      title={open ? 'Close Tweaks' : 'Tweaks: your own changes to the rules'}
      onClick={onToggle}
    >
      <i className="ti ti-adjustments" aria-hidden="true" />
      <span className="b-tweaks-label">Tweaks</span>
      <span className="b-tweaks-count">{count}</span>
      {dot && <span className="b-tweaks-dot" aria-hidden="true" />}
    </button>
  );
}
