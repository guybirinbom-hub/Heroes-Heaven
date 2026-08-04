import { useState } from 'react';
import type { Character, ContentDatabase } from '../rules/types';
import { deriveDefenses, type DefenseSource } from '../rules/derive';
import { explainDefense, type StatBreakdown } from '../rules/explain';
import { StatDetailModal } from './StatDetailModal';

/**
 * The character's resistances, weaknesses and immunities as pill rows, for the places that show a
 * character's identity rather than their live stats — the Details tab and the builder's summary.
 *
 * Self-contained on purpose: it derives its own data and owns its own breakdown modal, so a caller
 * only has to drop it in. Renders NOTHING when the character has none, because a permanently empty
 * "Resistances —" row is noise for the large majority of characters who have none; for the ones who
 * do, it is a section they read constantly.
 *
 * Clicking a pill opens the same StatDetailModal every other stat uses, listing each source and
 * marking any that lost the no-stacking rule.
 */
export function DefensesPills({ character, content }: { character: Character; content: ContentDatabase }) {
  const def = deriveDefenses(character, content);
  const [brk, setBrk] = useState<StatBreakdown | null>(null);

  const has = def.resistances.length > 0 || def.weaknesses.length > 0 || def.immunities.length > 0 || def.negativeHealing;
  if (!has) return null;

  const label = (t: string) => {
    const s = t.replace(/-/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  const pill = (key: string, text: string, sources: DefenseSource[] | undefined, open: () => void) => (
    <span key={key} className="lang-pill iwr-pill" role="button" tabIndex={0} title="How is this calculated?" onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
    >
      {text}
      {sources?.some((s) => s.condition) && <span className="iwr-cond">*</span>}
    </span>
  );

  return (
    <>
      {def.resistances.length > 0 && (
        <div className="id-row">
          <span className="idl">Resistances</span>
          <div className="idpills">
            {def.resistances.map((r) =>
              pill(r.type, `${label(r.type)} ${r.value}`, def.sources?.[`resistance:${r.type}`], () =>
                setBrk(explainDefense(def, 'resistance', r.type)),
              ),
            )}
          </div>
        </div>
      )}
      {def.weaknesses.length > 0 && (
        <div className="id-row">
          <span className="idl">Weaknesses</span>
          <div className="idpills">
            {def.weaknesses.map((w) =>
              pill(w.type, `${label(w.type)} ${w.value}`, def.sources?.[`weakness:${w.type}`], () =>
                setBrk(explainDefense(def, 'weakness', w.type)),
              ),
            )}
          </div>
        </div>
      )}
      {def.immunities.length > 0 && (
        <div className="id-row">
          <span className="idl">Immunities</span>
          <div className="idpills">
            {def.immunities.map((t) =>
              pill(t, label(t), def.sources?.[`immunity:${t}`], () => setBrk(explainDefense(def, 'immunity', t))),
            )}
          </div>
        </div>
      )}
      {def.negativeHealing && (
        <div className="id-row">
          <span className="idl">Void healing</span>
          <div className="idpills">
            <span className="lang-pill">healed by void, harmed by vitality</span>
          </div>
        </div>
      )}
      {brk && <StatDetailModal breakdown={brk} character={character} content={content} onClose={() => setBrk(null)} />}
    </>
  );
}
