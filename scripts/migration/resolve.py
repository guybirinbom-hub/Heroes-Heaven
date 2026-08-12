"""
Stage 1d — RESOLVE the records that neither joined nor were located inside a parent page.

Everything here turns on one idea: **scope the search to the record's own source book.**

Globally, typo-tolerant matching is dangerous — it pairs `Agate` with `Plate` and `Citrine` with
`Catrina` (see MIGRATION.md). Inside a single book it is safe: `Camouflage Coat` and `Camoflage Coat`
are the only two candidates that could possibly be each other, because a book contains a few hundred
docs, not 43,686. Heroes Heaven records carry `source.book`, and archive docs carry `book`, so the
scope is free.

Four rules, strongest first, each recorded so a weak match is never mistaken for a strong one:
  exact       — same book, identical normalised name
  no-paren    — same book, HH's trailing "(...)" removed ("Alchemist Armor Expertise (Level 13)")
  paren-only  — same book, ONLY the parenthetical ("Adept Benefit (Amulet)" -> the implement "Amulet")
  typo        — same book, Levenshtein <= 3 on the normalised name ("Camoflage Coat")

Anything still unresolved is either genuinely absent (the two un-scraped adventure volumes) or needs a
human. Nothing is ever taken from Foundry.

Read-only. Re-runnable. Writes scripts/migration/out/resolved.json.

    "C:/Users/r2g2/AppData/Local/Programs/Python/Python310/python.exe" scripts/migration/resolve.py
"""
import io, json, os, re, sqlite3
from collections import defaultdict

DB = r'C:/trying ai 2/Archives of GuyB/app/src-tauri/resources/aon.db'
CORE = 'public/core.json'
LOCATED = 'scripts/migration/out/located.json'
OUT = 'scripts/migration/out/resolved.json'

def norm_name(s):
    return re.sub(r'[^a-z0-9]+', '', str(s).lower())

def norm_book(s):
    """HH keeps Foundry's long book name, the archive the short one. Same rule as import-core-v2.mjs."""
    s = str(s or '').lower()
    s = re.sub(r'^pathfinder ', '', s)
    s = re.sub(r'^lost omens:? ', '', s)
    s = re.sub(r'\((?:remastered|remaster)\)', '', s)
    return re.sub(r'[^a-z0-9]', '', s)

def lev(a, b, cap=3):
    if abs(len(a) - len(b)) > cap:
        return cap + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        best = i
        for k, cb in enumerate(b, 1):
            cur.append(min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + (ca != cb)))
            best = min(best, cur[k])
        if best > cap:
            return cap + 1
        prev = cur
    return prev[-1]

# Which archive categories may satisfy which HH bucket. Reviewing the first run caught `Air Gate`
# (a class feature) matching the SPELL `Serrate`, and `Water Gate` matching the FEAT `Water Step`.
CAT_BUCKET = {
    'spell': 'spells', 'ritual': 'spells',
    'equipment': 'items', 'weapon': 'items', 'armor': 'items', 'shield': 'items', 'relic': 'items',
    'set-relic': 'items', 'class-kit': 'items', 'item-bonus': 'items',
    'class': 'classes', 'class-feature': 'classFeatures', 'feat': 'feats',
    'ancestry': 'ancestries', 'heritage': 'heritages', 'background': 'backgrounds',
    'deity': 'deities', 'language': 'languages', 'action': 'actions', 'condition': 'conditions',
    'animal-companion': 'animalCompanions', 'animal-companion-advanced': 'animalCompanions',
    'animal-companion-unique': 'animalCompanions',
    'animal-companion-specialization': 'companionSpecializations',
    'familiar-ability': 'familiarAbilities', 'familiar-specific': 'familiarAbilities',
    'vehicle': 'vehicles', 'siege-weapon': 'siegeWeapons',
}

def same_family(bucket, cat):
    return CAT_BUCKET.get(cat) == bucket

STOP = {'the', 'of', 'a', 'an', 'and', 'with'}

def words(s):
    return [w for w in re.findall(r'[a-z0-9]+', str(s).lower()) if w not in STOP]

def token_compatible(a, b):
    """
    True only when the two names are the SAME WORDS, differing by spelling.

    This is what separates a typo from a different thing. `Camouflage Coat` / `Camoflage Coat` keeps
    two tokens that each pair within an edit or two. `Red Dragon's Breath Potion` / `Dragon's Breath
    Potion` loses a whole token — and "Red" is exactly what distinguishes it from the Black and Brass
    ones, so dropping it would attach the wrong item. `Lotus Above the Wind` / `Lotus Above the Mud`
    keeps the count but `wind`/`mud` are nothing alike.
    """
    wa, wb = words(a), words(b)
    if len(wa) != len(wb) or not wa:
        return False
    for x, y in zip(wa, wb):
        if x == y:
            continue
        if lev(x, y, 2) > 2:
            return False
    return True

con = sqlite3.connect('file:%s?mode=ro' % DB, uri=True)
core = json.load(io.open(CORE, encoding='utf8'))
located = json.load(io.open(LOCATED, encoding='utf8'))

# archive docs grouped by normalised book
by_book = defaultdict(list)
for did, cat, name, book in con.execute('select id, category, name, book from docs'):
    by_book[norm_book(book)].append((did, cat, name, norm_name(name)))
print('archive books indexed:', len(by_book))

resolved, unresolved = {}, {}
counts = defaultdict(int)

for bucket, rows in located['buckets'].items():
    for row in rows:
        if row['in']:
            continue  # already located inside a parent page
        key, name = row.get('key'), row.get('name') or row.get('key')
        rec = (core.get(bucket) or {}).get(key) or {}
        book = ((rec.get('source') or {}).get('book')) or ''
        cands = by_book.get(norm_book(book), [])
        n = norm_name(name)
        bare = norm_name(re.sub(r'\s*\([^)]*\)\s*$', '', name))
        inner_m = re.search(r'\(([^)]*)\)\s*$', name)
        inner = norm_name(inner_m.group(1)) if inner_m else None

        hit = how = None
        if cands:
            for did, cat, nm, nn in cands:
                if nn == n:
                    hit, how = (did, cat, nm), 'exact'; break
            if not hit and bare and bare != n:
                for did, cat, nm, nn in cands:
                    if nn == bare:
                        hit, how = (did, cat, nm), 'no-paren'; break
            if not hit and inner:
                for did, cat, nm, nn in cands:
                    if nn == inner:
                        hit, how = (did, cat, nm), 'paren-only'; break
            if not hit:
                best, bd = None, 4
                for did, cat, nm, nn in cands:
                    if not same_family(bucket, cat):
                        continue          # guard 1: a class feature may not match a spell
                    if not token_compatible(name, nm):
                        continue          # guard 2: same words, only misspelled — see below
                    d = lev(n, nn)
                    if d < bd:
                        best, bd = (did, cat, nm), d
                if best and bd <= 3:
                    hit, how = best, 'typo(d=%d)' % bd

        if hit:
            resolved.setdefault(bucket, []).append(
                {'key': key, 'name': name, 'how': how, 'docId': hit[0], 'category': hit[1], 'archiveName': hit[2]})
            counts[how.split('(')[0]] += 1
        else:
            unresolved.setdefault(bucket, []).append(
                {'key': key, 'name': name, 'book': book, 'bookInArchive': len(cands)})
            counts['none'] += 1

os.makedirs('scripts/migration/out', exist_ok=True)
io.open(OUT, 'w', encoding='utf8').write(json.dumps({'resolved': resolved, 'unresolved': unresolved}, indent=1))

print('\n--- resolve ---')
for k in ('exact', 'no-paren', 'paren-only', 'typo', 'none'):
    if counts[k]:
        print('  %-12s %4d' % (k, counts[k]))
print('\nstill unresolved, by bucket:')
for b, l in sorted(unresolved.items(), key=lambda x: -len(x[1])):
    print('  %-20s %4d' % (b, len(l)))
print('\nwrote', OUT)
