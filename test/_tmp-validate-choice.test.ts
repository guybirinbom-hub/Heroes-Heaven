import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { content } from './_content';
import { openChoiceOptions } from '../src/rules/openChoice';
import { spellsMatching } from '../src/rules/spellChoice';

const c = content();
type Row = {
  id: string;
  verdict: string;
  choice?: { flag?: string; prompt?: string; kind?: string; options?: { value: string; label: string }[]; from?: never; picks?: number; inert?: unknown };
  effectChoices?: { id?: string; prompt?: string; options?: { value?: string; label?: string; grant?: Record<string, unknown> }[]; spellFilter?: never }[];
};
const rows = JSON.parse(readFileSync('work/choice-apply.json', 'utf8')) as Row[];
const COLS = ['feats', 'classFeatures', 'items', 'heritages', 'backgrounds', 'ancestries'] as const;

describe('proposed build choices', () => {
  it('report', () => {
    const problems: string[] = [];
    const db = c as unknown as Record<string, Record<string, { choice?: unknown; effectChoices?: unknown[] }>>;
    for (const r of rows) {
      const col = COLS.find((k) => db[k]?.[r.id]);
      if (!col) { problems.push(`${r.id}: NOT IN core.json`); continue; }
      const rec = db[col][r.id];

      if (r.verdict === 'choice') {
        const d = r.choice;
        if (!d) { problems.push(`${r.id}: verdict choice but no def`); continue; }
        if (rec.choice) problems.push(`${r.id}: ALREADY has a choice — would clobber`);
        if (!d.flag || !d.prompt) problems.push(`${r.id}: missing flag/prompt`);
        if (!['array', 'text', 'open', 'skills'].includes(String(d.kind))) problems.push(`${r.id}: bad kind ${d.kind}`);
        if (d.inert !== undefined && typeof d.inert !== 'string') problems.push(`${r.id}: inert must be a STRING reason, got ${typeof d.inert}`);
        if (d.kind === 'array') {
          const o = d.options ?? [];
          if (o.length < 2) problems.push(`${r.id}: array with ${o.length} options`);
          if (o.some((x) => !x.value || !x.label)) problems.push(`${r.id}: blank option value/label`);
          if (new Set(o.map((x) => x.value)).size !== o.length) problems.push(`${r.id}: duplicate option values`);
          if ((d.picks ?? 1) >= o.length) problems.push(`${r.id}: picks ${d.picks} >= ${o.length}`);
        }
        if (d.kind === 'open') {
          if (!d.from) problems.push(`${r.id}: open with no from`);
          else if (!String((d.from as { type?: string }).type ?? '').startsWith('own-')) {
            const n = openChoiceOptions(d.from, c).length;
            if (n === 0) problems.push(`${r.id}: open picker resolves to ZERO — ${JSON.stringify(d.from)}`);
            if (n > 900) problems.push(`${r.id}: open picker resolves to ${n} options — filter looks too broad`);
          }
        }
      } else {
        const ecs = r.effectChoices ?? [];
        if (!ecs.length) { problems.push(`${r.id}: verdict effectChoices but none`); continue; }
        if ((rec.effectChoices ?? []).length) problems.push(`${r.id}: ALREADY has effectChoices — would clobber`);
        for (const e of ecs) {
          if (!e.id || !e.prompt) problems.push(`${r.id}: effectChoice missing id/prompt`);
          if (e.options && e.spellFilter) problems.push(`${r.id}/${e.id}: both options and spellFilter`);
          if (!e.options && !e.spellFilter) problems.push(`${r.id}/${e.id}: neither`);
          if (e.options) {
            if (e.options.length < 2) problems.push(`${r.id}/${e.id}: ${e.options.length} option(s)`);
            for (const o of e.options) {
              if (!o.value || !o.label) problems.push(`${r.id}/${e.id}: blank option`);
              const g = o.grant as { innateSpells?: { spellId: string }[]; focusSpells?: string[] } | undefined;
              for (const s of g?.innateSpells ?? []) if (!c.spells[s.spellId]) problems.push(`${r.id}/${o.value}: spell '${s.spellId}' missing`);
              for (const s of g?.focusSpells ?? []) if (!c.spells[s]) problems.push(`${r.id}/${o.value}: focus '${s}' missing`);
            }
          }
          if (e.spellFilter) {
            const n = spellsMatching(e.spellFilter, c).length;
            if (n === 0) problems.push(`${r.id}/${e.id}: spellFilter resolves to ZERO`);
          }
        }
      }
    }
    console.log(`\n${rows.length} proposed, ${problems.length} problems:\n` + problems.map((p) => '  ' + p).join('\n'));
    expect(true).toBe(true);
  });
});
