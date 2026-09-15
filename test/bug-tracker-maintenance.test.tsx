// tracker 2026-09-15: maintenance
//
// Lane D (maintenance) of the 2026-09-15 tracker cleanup batch. Covers: dead Electron branches,
// the three zero-importer components, the native confirm() dialog in SettingsModal, and the new
// search ranking. File ownership for that batch was scoped to a fixed list of tracker/src files —
// see the exclusion list below for what was knowingly left alone and why.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { rankBySearch } from '../tracker/src/utils/searchRank';

const TRACKER_SRC = join(__dirname, '..', 'tracker', 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|css)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(TRACKER_SRC).map((abs) => ({ abs, rel: relative(TRACKER_SRC, abs).replace(/\\/g, '/') }));

// Files that still mention "Electron" in a comment only (no real `window.electronAPI` branch left)
// and were deliberately left alone: hh-chrome.css's comment is still accurate (the row it describes
// still carries WebkitAppRegion: 'drag'). Listed here, not silently passed.
const OUT_OF_LANE_ELECTRON_FILES = new Set([
  'hh-chrome.css',
]);

describe('tracker 2026-09-15: maintenance', () => {
  it('has no electron identifiers left outside the out-of-lane exceptions', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (OUT_OF_LANE_ELECTRON_FILES.has(f.rel)) continue;
      const text = readFileSync(f.abs, 'utf8');
      if (/electron/i.test(text)) offenders.push(f.rel);
    }
    expect(offenders).toEqual([]);
  });

  it('deletes CustomStatBlockEditor, PartyManager and ThemeEditor, and nothing imports them', () => {
    const deletedNames = ['CustomStatBlockEditor', 'PartyManager', 'ThemeEditor'];
    for (const name of deletedNames) {
      expect(existsSync(join(TRACKER_SRC, 'components', `${name}.tsx`))).toBe(false);
      expect(existsSync(join(TRACKER_SRC, 'components', `${name}.css`))).toBe(false);
    }
    const importerPattern = new RegExp(`from ['"][^'"]*(?:${deletedNames.join('|')})['"]`);
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f.abs, 'utf8');
      if (importerPattern.test(text)) offenders.push(f.rel);
    }
    expect(offenders).toEqual([]);
  });

  it('SettingsModal has no native confirm() dialog', () => {
    const text = readFileSync(join(TRACKER_SRC, 'components', 'SettingsModal.tsx'), 'utf8');
    expect(text).not.toContain('window.confirm(');
  });

  // MonsterSearch and GlobalSearch both route their text search through searchMatches + rankBySearch
  // (tracker/src/utils/searchRank.ts, a verbatim copy of src/data/searchRank.ts). This exercises that
  // shared matcher directly rather than rendering either component: a name-exact hit must outrank a
  // row that only matches in some other field, the exact bug the owner reported (search "waterskin",
  // it lands 16th behind rows that only mention one in their description).
  it('ranks a name-exact match above a hit that only matches another field', () => {
    type Row = { name: string; desc: string };
    const rows: Row[] = [
      { name: "Adventurer's Pack", desc: 'Contains a waterskin, rope, and rations.' },
      { name: 'Waterskin', desc: 'A leather pouch for carrying water.' },
    ];
    const query = 'waterskin';
    const matched = rows.filter(
      (r) => r.name.toLowerCase().includes(query) || r.desc.toLowerCase().includes(query),
    );
    const ranked = rankBySearch(matched, query, (r) => r.name, (r) => r.desc);
    expect(ranked[0].name).toBe('Waterskin');
  });
});
