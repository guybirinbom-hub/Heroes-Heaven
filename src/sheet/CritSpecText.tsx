import type { ReactNode } from 'react';
import type { ContentDatabase } from '../rules/types';
import { InfoTerm } from './InfoTerm';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Render a critical-specialization sentence (or similar reference text), turning any condition it
 * mentions (Slowed, Off-Guard, Prone, …) into a clickable term that opens that condition's
 * description. Conditions are matched by their exact names from content (longest first, so
 * multi-word names like "Off-Guard" win); only names that actually exist in content link.
 */
export function CritSpecText({ text, content }: { text: string; content: ContentDatabase }) {
  const conds = Object.values(content.conditions ?? {});
  if (!conds.length) return <>{text}</>;
  const byName = new Map(conds.map((c) => [c.name.toLowerCase(), c]));
  const names = conds.map((c) => c.name).sort((a, b) => b.length - a.length);
  const re = new RegExp('\\b(' + names.map(escapeRe).join('|') + ')\\b', 'gi');
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const cond = byName.get(m[0].toLowerCase());
    out.push(
      <InfoTerm
        key={key++}
        className="crit-cond"
        title={cond?.name ?? m[0]}
        description={cond?.description}
        descRefs={cond?.descRefs}
        descKey="conditions"
      >
        {m[0]}
      </InfoTerm>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
