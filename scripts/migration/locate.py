"""
Stage 1c — LOCATE the records that have no archive doc of their own.

The user resolved five examples by hand and they all turned out to be the same shape: Heroes Heaven
keeps as its own record something the Archives keeps as a SECTION INSIDE a bigger page.

  Curse of Ancestral Meddling  -> a block inside the Oracle Mystery page "Ancestors"
  Familiar of Balanced Luck    -> a line inside the Witch Patron Theme "Spinner of Threads"
  Accept Echo                  -> an action described inside the feat "Echo of the Fallen"
  Adept Benefit (Amulet)       -> inside the implement page "Amulet"           (found earlier)
  Bloodline: Aberrant          -> the bloodline page "Aberrant"                (found earlier)

So the question for the remaining records is not "is it in the archive" but "which page is it inside".
This searches the archive's full text for each unmatched name and reports the containing doc, using
the db's own FTS5 index (docs_fts) so it is one indexed query per name rather than 963 table scans.

Read-only. Re-runnable. Writes scripts/migration/out/located.json.

    "C:/Users/r2g2/AppData/Local/Programs/Python/Python310/python.exe" scripts/migration/locate.py
"""
import json, io, os, re, sqlite3, sys

DB = r'C:/trying ai 2/Archives of GuyB/app/src-tauri/resources/aon.db'
JOIN = 'scripts/migration/out/join.json'
OUT = 'scripts/migration/out/located.json'

con = sqlite3.connect('file:%s?mode=ro' % DB, uri=True)
join = json.load(io.open(JOIN, encoding='utf8'))

def fts_quote(s):
    """FTS5 phrase query. Strip punctuation FTS treats as syntax, then quote as a phrase."""
    cleaned = re.sub(r'["\'()*:^-]', ' ', s)
    cleaned = ' '.join(cleaned.split())
    return '"%s"' % cleaned if cleaned else None

results = {}
totals = {'searched': 0, 'located': 0, 'nothing': 0}

for bucket, records in join.get('unmatched', {}).items():
    out = []
    for rec in records:
        name = rec.get('name') or rec.get('key')
        totals['searched'] += 1
        q = fts_quote(name)
        hits = []
        if q:
            try:
                # rank orders by BM25; the containing page is normally the strongest hit.
                cur = con.execute(
                    "select d.id, d.category, d.name from docs_fts f "
                    "join docs d on d.rowid = f.rowid "
                    "where docs_fts match ? order by rank limit 4", (q,))
                hits = [{'id': r[0], 'category': r[1], 'name': r[2]} for r in cur]
            except sqlite3.OperationalError:
                hits = []
        if hits:
            totals['located'] += 1
        else:
            totals['nothing'] += 1
        out.append({'name': name, 'key': rec.get('key'), 'in': hits})
    results[bucket] = out
    loc = sum(1 for r in out if r['in'])
    print('%-20s %4d records | found inside a page: %4d | nothing: %4d' % (bucket, len(out), loc, len(out) - loc))

os.makedirs('scripts/migration/out', exist_ok=True)
io.open(OUT, 'w', encoding='utf8').write(json.dumps({'totals': totals, 'buckets': results}, indent=1))
print('\nsearched %d | located %d | nothing %d' % (totals['searched'], totals['located'], totals['nothing']))
print('wrote', OUT)
