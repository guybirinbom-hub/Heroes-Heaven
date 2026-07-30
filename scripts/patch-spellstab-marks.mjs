// One-shot: thread the ruling-G spell markers into every SpellCard that knows its spell id.
// Idempotent — a card that already has `marks=` is left alone.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const F = path.join(path.resolve(import.meta.dirname, '..'), 'src/sheet/SpellsTab.tsx');
let s = readFileSync(F, 'utf8');

// An earlier partial run doubled two of them.
s = s.replace(/(\bmarks=\{marksFor\([^)]*\)\})(\s*\1)+/g, '$1');
s = s.replace(/^(\s*)(marks=\{marksFor\([^)]*\)\})\n\1\2\n/gm, '$1$2\n');

let added = 0;
// Every SpellCard element, whether one line or many. The id comes from the `name=` prop, which is the
// only place each call site names the spell it is rendering.
s = s.replace(/<SpellCard\b[\s\S]*?\/>/g, (el) => {
  if (/\bmarks=/.test(el)) return el;
  const m =
    /name=\{sp\?\.name \?\? ([A-Za-z_$][\w.$]*)\}/.exec(el) ??
    /name=\{(sp)\.name\}/.exec(el);
  if (!m) return el;
  const id = m[1] === 'sp' ? 'sp.id' : m[1];
  added++;
  return el.replace(/(name=\{[^}]*\})/, `$1 marks={marksFor(${id})}`);
});

writeFileSync(F, s);
console.log(`marks added to ${added} more SpellCard call sites`);
