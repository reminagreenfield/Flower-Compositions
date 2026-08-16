"""Split a staged category into specimens and merge into scans/ + scans_split/.

  python merge_category.py <staging_dir> [--apply]
Numbering continues from whatever each species already has on disk.
"""
import csv, os, re, sys, shutil, collections, numpy as np
from PIL import Image
from scipy import ndimage

stage = sys.argv[1]
APPLY = "--apply" in sys.argv
SHEETS, PIECES = "scans", "scans_split"

def slug(n):
    return re.sub(r"[^a-z0-9]+", "-", n.lower()).strip("-") or "unnamed"

new = list(csv.DictReader(open(os.path.join(stage, "_manifest.csv"), encoding="utf-8")))
old_sheets = list(csv.DictReader(open("scans_manifest.csv", encoding="utf-8")))

# continue each species' numbering from the highest already present
start = collections.Counter()
for r in old_sheets:
    m = re.fullmatch(r"(.+)-(\d{2})\.png", r["file"])
    if m: start[m.group(1)] = max(start[m.group(1)], int(m.group(2)))

new.sort(key=lambda r: (slug(r["name"]), r["slug"]))
seq = collections.Counter(start)
plan = []
for r in new:
    if not r["file"]: continue
    sp = slug(r["name"]); seq[sp] += 1
    plan.append({**r, "new_file": f"{sp}-{seq[sp]:02d}.png", "stem": f"{sp}-{seq[sp]:02d}"})

print(f"staged sheets: {len(plan)}")
for p in plan[:3]: print("  ", p["file"], "->", p["new_file"])
existing = set(os.listdir(SHEETS))
clash = [p["new_file"] for p in plan if p["new_file"] in existing]
print("sheet name clashes with existing:", len(clash), clash[:3])
if not APPLY:
    print("\nDRY RUN — pass --apply"); sys.exit()
if clash:
    sys.exit("refusing: would overwrite existing sheets")

piece_rows, tally = [], []
for p in plan:
    im = Image.open(os.path.join(stage, p["file"])).convert("RGBA")
    a = np.array(im.split()[3]); mask = a > 24
    mask = ndimage.binary_closing(mask, structure=np.ones((5, 5)))
    lab, n = ndimage.label(mask, structure=np.ones((3, 3)))
    kept = 0
    if n:
        areas = ndimage.sum(mask, lab, range(1, n + 1))
        boxes = ndimage.find_objects(lab)
        for idx in [i + 1 for i, ar in enumerate(areas) if ar >= 400]:
            sy, sx = boxes[idx - 1]
            h, w = sy.stop - sy.start, sx.stop - sx.start
            if h < 16 or w < 16: continue
            piece = im.crop((sx.start, sy.start, sx.stop, sy.stop))
            sub = (lab[sy, sx] == idx)
            pa = np.array(piece.split()[3]); pa[~sub] = 0
            piece.putalpha(Image.fromarray(pa))
            kept += 1
            fn = f"{p['stem']}-{kept:02d}.png"
            piece.save(os.path.join(PIECES, fn))
            piece_rows.append({"name": p["name"], "file": fn, "sheet": p["stem"],
                               "px_w": w, "px_h": h, "source": p["slug"],
                               "old_file": ""})
    tally.append(kept)
    shutil.copy2(os.path.join(stage, p["file"]), os.path.join(SHEETS, p["new_file"]))

with open("scans_manifest.csv", "a", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=["name", "file", "slug", "old_file", "url"])
    for p in plan:
        w.writerow({"name": p["name"], "file": p["new_file"], "slug": p["slug"],
                    "old_file": p["file"], "url": p["url"]})
with open("scans_split_manifest.csv", "a", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=["name", "file", "sheet", "px_w", "px_h", "source", "old_file"])
    w.writerows(piece_rows)

t = np.array(tally)
print(f"sheets merged: {len(plan)}   specimens cut: {len(piece_rows)}")
print(f"per sheet: min {t.min()} median {int(np.median(t))} max {t.max()}")
