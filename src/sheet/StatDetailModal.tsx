import { useState, type ReactNode } from 'react';
import type { ActionCost, Character, ContentDatabase } from '../rules/types';
import { formatMod } from '../rules/derive';
import { RANK_LABEL, nameOfRecord, recordMarkersFor, type StatBreakdown } from '../rules/explain';
import { skillActionsFor } from '../rules/skillActions';
import { ActionGlyph, RankPill, SituationalStar } from './widgets';
import { useEscapeClose } from './useEscapeClose';
import { DescBody } from './DescBody';

/** An action name to its core.json id — the same kebab-casing MainTab uses, so a marker authored
 *  against "treat-wounds" is found from either surface. */
const actionSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/** Parse a skill-action cost string ("1 action", "free", "reaction", "1 to 3 actions") into
 *  an ActionCost so it renders as glyphs. Returns null for non-action text ("varies",
 *  "10 minutes"), which is then shown as-is. */
function parseActionCost(text?: string): ActionCost | null {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  if (t === 'free' || t === 'free action') return { type: 'free' };
  if (t === 'reaction') return { type: 'reaction' };
  const single = t.match(/^(\d)\s*actions?$/);
  if (single) {
    const v = Number(single[1]);
    if (v >= 1 && v <= 3) return { type: 'actions', value: v as 1 | 2 | 3 };
  }
  const range = t.match(/^(\d)\s*(?:to|–|-)\s*(\d)\s*actions?$/);
  if (range) return { type: 'variable', min: Number(range[1]) as 1 | 2 | 3, max: Number(range[2]) as 1 | 2 | 3 };
  return null;
}

/** The "why is this number what it is" panel: calculation, level-by-level history,
 *  description, and (for skills) the actions you can take at your proficiency. */
export function StatDetailModal({
  breakdown,
  character,
  content,
  onRoll,
  onClose,
  editor,
}: {
  breakdown: StatBreakdown;
  character: Character;
  content: ContentDatabase;
  onRoll?: (label: string, modifier: number) => void;
  onClose: () => void;
  /** Optional interactive control (e.g. the temporary-Speed editor) shown atop the body. */
  editor?: ReactNode;
}) {
  useEscapeClose(onClose);
  // Ruling H: the star note is capped at one line, and this holds the full text it was trimmed from.
  const [fullText, setFullText] = useState<{ name: string; html: string; id?: string; bucket?: string } | null>(null);
  const b = breakdown;
  const featNames = new Set(character.feats.map((f) => content.feats[f.featId]?.name).filter(Boolean) as string[]);
  const actions = b.skill && b.rank ? skillActionsFor(b.skill, b.rank, (n) => featNames.has(n)) : [];

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker stat-detail" onClick={(e) => e.stopPropagation()}>
        <div className="sd-head">
          <div className="sd-head-main">
            <div className="sd-title">{b.title}</div>
            {b.subtitle && <div className="sd-subtitle">{b.subtitle}</div>}
          </div>
          {b.rank && <RankPill rank={b.rank} />}
          <span className="sd-total">{b.totalText}</span>
          {b.roll && onRoll && (
            <button
              className="sd-roll"
              onClick={() => {
                onRoll(b.roll!.label, b.roll!.modifier);
                onClose();
              }}
            >
              <i className="ti ti-dice-5" aria-hidden="true" /> Roll
            </button>
          )}
          <button className="picker-close" onClick={onClose} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        <div className="sd-body">
          {editor && <section className="sd-sec sd-editor">{editor}</section>}
          {/* Spell damage has no computed total — each spell rolls its own — so a "How it's
              calculated / Total: varies" block with no rows would say nothing. */}
          {b.parts.length > 0 && (
          <section className="sd-sec">
            <div className="sd-sec-label">How it's calculated</div>
            <div className="sd-calc">
              {b.parts.map((p, i) => (
                <div className="sd-calc-row" key={i}>
                  <span className="sd-calc-label">{p.label}</span>
                  {p.note && <span className="sd-calc-note">{p.note}</span>}
                  <span className="sd-calc-val">{formatMod(p.value)}</span>
                </div>
              ))}
              <div className="sd-calc-row sd-calc-total">
                <span className="sd-calc-label">Total</span>
                <span className="sd-calc-val">{b.totalText}</span>
              </div>
            </div>
          </section>
          )}

          {b.situational && b.situational.length > 0 && (
            <section className="sd-sec">
              <div className="sd-sec-label">Situational (apply when it fits)</div>
              <ul className="sd-situational">
                {b.situational.map((s, i) => {
                  // Notes are capped at about one line, so the trigger stays readable in a list. The
                  // record itself holds the full wording, and this is the click that opens it —
                  // without it, a trimmed note would be the only version the player ever sees.
                  const rec = s.sourceId && s.sourceCollection
                    ? (content[s.sourceCollection] as Record<string, { name?: string; description?: string } | undefined>)?.[s.sourceId]
                    : undefined;
                  return (
                    <li key={i} className={s.dcOnly ? 'sd-sit-dc' : undefined}>
                      {s.text}
                      {rec?.description && (
                        <button
                          type="button"
                          className="sd-sit-more"
                          title={`Read all of ${rec.name ?? 'this'}`}
                          onClick={() => setFullText({ name: rec.name ?? '', html: rec.description!, id: s.sourceId, bucket: s.sourceCollection })}
                        >
                          Full text
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {b.timeline.length > 0 && (
            <section className="sd-sec">
              <div className="sd-sec-label">How you got here</div>
              <div className="sd-timeline">
                {b.timeline.map((t, i) => (
                  <div className="sd-tl-row" key={i}>
                    <span className="sd-tl-lvl">{t.level}</span>
                    <div className="sd-tl-text">
                      <div>{t.text}</div>
                      {t.detail && <div className="sd-tl-detail">{t.detail}</div>}
                    </div>
                    {t.rank && <RankPill rank={t.rank} />}
                  </div>
                ))}
              </div>
            </section>
          )}

          {b.description && (
            <section className="sd-sec">
              <div className="sd-sec-label">About</div>
              <p className="sd-desc">{b.description}</p>
            </section>
          )}

          {b.skill && (
            <section className="sd-sec">
              <div className="sd-sec-label">
                Actions you can take
                {b.rank && b.rank !== 'untrained' && <span className="sd-rank-note"> at {RANK_LABEL[b.rank]}</span>}
              </div>
              {actions.length === 0 ? (
                <p className="sd-desc">No special actions unlocked yet at this proficiency.</p>
              ) : (
                <div className="sd-actions">
                  {actions.map((a, i) => (
                    <details className="sd-action" key={a.name + i} open={i === 0}>
                      <summary>
                        <span className="sd-act-chev">
                          <i className="ti ti-chevron-right" aria-hidden="true" />
                        </span>
                        <span className="sd-act-name">{a.name}</span>
                        {/* Ruling D: "Magic Hands show the d10 in () in the treat wounds action, with a *
                            linking to the feat". A skill action renders HERE, not in the activity list,
                            so this is where its marker has to be. */}
                        {(() => {
                          const marks = recordMarkersFor(character, content, 'action', actionSlug(a.name));
                          if (!marks.length) return null;
                          const val = marks.find((m) => m.value)?.value;
                          return (
                            <span className="action-mark" title={marks.map((m) => `${nameOfRecord(content, m.sourceId)}: ${m.note}`).join('\n')}>
                              {val && <span className="action-mark-val">({val})</span>}
                              <SituationalStar />
                            </span>
                          );
                        })()}
                        {(() => {
                          const cost = parseActionCost(a.costText);
                          if (cost) return <span className="sd-act-cost"><ActionGlyph cost={cost} /></span>;
                          return a.costText ? <span className="sd-act-cost">{a.costText}</span> : null;
                        })()}
                        {a.feat && <span className="sd-act-feat">feat</span>}
                      </summary>
                      <div className="sd-act-body">
                        <p>{a.desc}</p>
                        {a.tiers && a.tiers.length > 0 && (
                          <ul className="sd-tiers">
                            {a.tiers.map((t, j) => (
                              <li key={j}>
                                <strong>{RANK_LABEL[t.rank]}:</strong> {t.note}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {/* The full printed text of a note that was capped to one line. Stacked over this modal rather
          than replacing it, so closing it returns you to the stat you were reading. */}
      {fullText && (
        <div className="picker-overlay" onClick={(e) => { e.stopPropagation(); setFullText(null); }}>
          <div className="picker confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="picker-head">
              <span>{fullText.name}</span>
              <button className="picker-close" onClick={() => setFullText(null)} aria-label="Close">
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </div>
            <div className="confirm-body">
              <DescBody description={fullText.html} astKey={fullText.bucket} astId={fullText.id} onExit={() => setFullText(null)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
