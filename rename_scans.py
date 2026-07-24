"""Rename hashed scan files to readable species-based names.

  scans/       papaver-rhoeas-03.png          sheet 3 of that species
  scans_split/ papaver-rhoeas-03-07.png       piece 7 cut from that sheet
"""
import csv, os, re, sys, collections

DRY = "--apply" not in sys.argv
SHEETS, PIECES = "scans", "scans_split"

def clean(n):
    n = " ".join(n.split())
    return n[:-5].strip() if n.endswith("1 Cr") else n

def slug(n):
    s = re.sub(r"[^a-z0-9]+", "-", n.lower()).strip("-")
    return s or "unnamed"

sheets = list(csv.DictReader(open("scans_manifest.csv", encoding="utf-8")))
pieces = list(csv.DictReader(open("scans_split_manifest.csv", encoding="utf-8")))

# number each species' sheets in a stable order
sheets.sort(key=lambda r: (slug(clean(r["name"])), r["slug"]))
seq, sheet_new = collections.Counter(), {}
for r in sheets:
    sp = slug(clean(r["name"]))
    seq[sp] += 1
    ext = os.path.splitext(r["file"])[1] or ".png"
    sheet_new[r["slug"]] = f"{sp}-{seq[sp]:02d}{ext}"

# pieces inherit their sheet's new stem, keeping their own piece number
by_src = collections.defaultdict(list)
for p in pieces:
    by_src[p["source"]].append(p)
piece_new = {}
for src, group in by_src.items():
    stem = os.path.splitext(sheet_new.get(src, src))[0]
    group.sort(key=lambda p: p["file"])
    for i, p in enumerate(group, 1):
        piece_new[p["file"]] = f"{stem}-{i:02d}.png"

def apply(folder, mapping, key_is_path):
    done = miss = 0
    tmp = {}
    for old, new in mapping.items():
        op = os.path.join(folder, old if key_is_path else old)
        if not os.path.exists(op):
            miss += 1; continue
        if op == os.path.join(folder, new):
            done += 1; continue
        t = os.path.join(folder, "__tmp__" + new)
        os.rename(op, t); tmp[t] = os.path.join(folder, new)
    for t, n in tmp.items():
        os.rename(t, n); done += 1
    return done, miss

sheet_files = {r["file"]: sheet_new[r["slug"]] for r in sheets if r["file"]}
collide = len(set(sheet_files.values())) != len(sheet_files) or \
          len(set(piece_new.values())) != len(piece_new)
print("name collisions:", collide)
print(f"sheets to rename: {len(sheet_files)}   pieces to rename: {len(piece_new)}")
for k, v in list(sheet_files.items())[:3]: print("  ", k, "->", v)
for k, v in list(piece_new.items())[:3]:   print("  ", k, "->", v)

if DRY:
    print("\nDRY RUN — pass --apply to perform the rename")
    sys.exit()
if collide:
    sys.exit("refusing to rename: duplicate target names")

print("sheets:", apply(SHEETS, sheet_files, True))
print("pieces:", apply(PIECES, piece_new, True))

for r in sheets:
    r["old_file"] = r["file"]; r["file"] = sheet_new[r["slug"]]; r["name"] = clean(r["name"])
for p in pieces:
    p["old_file"] = p["file"]; p["file"] = piece_new[p["file"]]; p["name"] = clean(p["name"])
    p["sheet"] = os.path.splitext(sheet_new.get(p["source"], ""))[0]

with open("scans_manifest.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=["name", "file", "slug", "old_file", "url"])
    w.writeheader(); w.writerows([{k: r[k] for k in w.fieldnames} for r in sheets])
with open("scans_split_manifest.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=["name", "file", "sheet", "px_w", "px_h", "source", "old_file"])
    w.writeheader(); w.writerows([{k: p[k] for k in w.fieldnames} for p in pieces])
print("manifests rewritten")
