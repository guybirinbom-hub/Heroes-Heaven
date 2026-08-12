"""
Stage 1f — the last ~54 records.

`locate.py` used the FTS index, which searches the indexed BODY text. That misses two things:
a phrase broken across a table cell, and a name that only appears inside a field FTS does not index.
The gems proved it matters — `Citrine` is a row in a table on the "Gems" rules page.

So this does the slow, thorough thing exactly once: load every doc's raw JSON, lowercase it, and look
for each leftover name as a plain substring. One pass over the corpus, all names at once.

Read-only. Re-runnable (~2 minutes). Writes scripts/migration/out/leftovers.json.

    "C:/Users/r2g2/AppData/Local/Programs/Python/Python310/python.exe" scripts/migration/leftovers.py
"""
import io, json, os, re, sqlite3
from collections import defaultdict

DB = r'C:/trying ai 2/Archives of GuyB/app/src-tauri/resources/aon.db'
RESOLVED = 'scripts/migration/out/resolved.json'
DROP = 'scripts/migration/out/drop-adventure-loot.json'
OUT = 'scripts/migration/out/leftovers.json'

resolved = json.load(io.open(RESOLVED, encoding='utf8'))
dropped = {r['name'] for r in json.load(io.open(DROP, encoding='utf8'))['records']}

# Everything still unresolved, minus the adventure loot the user chose to drop.
todo = []
for bucket, rows in resolved['unresolved'].items():
    for r in rows:
        if r['name'] in dropped:
            continue
        todo.append({'bucket': bucket, 'name': r['name'], 'key': r.get('key'), 'book': r.get('book') or ''})
print('leftovers to place:', len(todo))
for b, n in sorted(defaultdict(int, {b: sum(1 for t in todo if t['bucket'] == b) for b in {t['bucket'] for t in todo}}).items()):
    print('   %-18s %3d' % (b, n))

needles = [(t, t['name'].lower()) for t in todo]
hits = defaultdict(list)

con = sqlite3.connect('file:%s?mode=ro' % DB, uri=True)
scanned = 0
for did, cat, name, js in con.execute('select id, category, name, json from docs'):
    scanned += 1
    low = (js or '').lower()
    for t, needle in needles:
        if needle in low:
            key = t['bucket'] + '|' + t['name']
            if len(hits[key]) < 5:
                hits[key].append({'id': did, 'category': cat, 'name': name})
print('scanned', scanned, 'docs')

found, nothing = [], []
for t in todo:
    key = t['bucket'] + '|' + t['name']
    where = hits.get(key, [])
    # A doc that merely IS the record is not interesting; we already know it has no doc of its own.
    (found if where else nothing).append({**t, 'insideDocs': where})

os.makedirs('scripts/migration/out', exist_ok=True)
io.open(OUT, 'w', encoding='utf8').write(json.dumps({'found': found, 'nothing': nothing}, indent=1))

print('\nappears inside some doc : %d' % len(found))
print('appears nowhere at all  : %d' % len(nothing))
if nothing:
    print('\nnowhere:')
    for t in nothing:
        print('   %-18s %-42s [%s]' % (t['bucket'], t['name'][:42], t['book'][:34]))
print('\nwrote', OUT)
