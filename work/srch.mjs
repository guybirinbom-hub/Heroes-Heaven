import fs from 'fs';
import path from 'path';

const roots = ['src', 'test'];
const files = [];
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name === 'node_modules') continue; walk(p); }
    else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) files.push(p);
  }
}
for (const r of roots) if (fs.existsSync(r)) walk(r);
for (const f of fs.readdirSync('scripts')) if (/\.mjs$/.test(f)) files.push(path.join('scripts', f));
for (const f of fs.readdirSync('scripts/data')) if (/\.json$/.test(f)) files.push(path.join('scripts/data', f));
if (fs.existsSync('scripts/lib')) for (const f of fs.readdirSync('scripts/lib')) files.push(path.join('scripts/lib', f));
if (fs.existsSync('scripts/aon-verify')) for (const f of fs.readdirSync('scripts/aon-verify')) { const p = path.join('scripts/aon-verify', f); if (fs.statSync(p).isFile()) files.push(p); }

const terms = process.argv.slice(2);
for (const term of terms) {
  console.log('##### ' + term);
  let n = 0;
  for (const f of files) {
    let txt;
    try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
    if (!txt.includes(term)) continue;
    const lines = txt.split(/\r?\n/);
    if (lines.length < 3 && txt.length > 200000) {
      // single-line json: report count + surrounding context
      let idx = 0, c = 0;
      while ((idx = txt.indexOf(term, idx)) !== -1 && c < 3) { console.log(`  ${f}:~ ...${txt.slice(Math.max(0,idx-200), idx+200).replace(/\s+/g,' ')}...`); idx += term.length; c++; n++; }
      continue;
    }
    lines.forEach((l, i) => {
      if (l.includes(term) && n < 60) { console.log(`  ${f}:${i + 1}: ${l.trim().slice(0, 300)}`); n++; }
    });
  }
  if (n === 0) console.log('  (no hits)');
}
