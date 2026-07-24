"""Cut each atlas sheet into its individual specimens using the alpha channel."""
import os, csv, numpy as np
from PIL import Image
from scipy import ndimage

SRC, OUT = "scans", "scans_split"
os.makedirs(OUT, exist_ok=True)
rows = list(csv.DictReader(open("scans_manifest.csv", encoding="utf-8")))

def clean(n):                      # names carry a trailing credit badge
    return " ".join(n.split())[:-5].strip() if n.strip().endswith("1 Cr") else " ".join(n.split())

out, tally = [], []
for r in rows:
    if not r["file"]: continue
    im = Image.open(os.path.join(SRC, r["file"])).convert("RGBA")
    a = np.array(im.split()[3])
    mask = a > 24
    # close small gaps so an antialiased specimen doesn't fragment
    mask = ndimage.binary_closing(mask, structure=np.ones((5, 5)))
    lab, n = ndimage.label(mask, structure=np.ones((3, 3)))
    if n == 0: continue
    areas = ndimage.sum(mask, lab, range(1, n + 1))
    keep = [i + 1 for i, ar in enumerate(areas) if ar >= 400]     # drop specks
    boxes = ndimage.find_objects(lab)
    kept = 0
    for idx in keep:
        sy, sx = boxes[idx - 1]
        h, w = sy.stop - sy.start, sx.stop - sx.start
        if h < 16 or w < 16: continue
        piece = im.crop((sx.start, sy.start, sx.stop, sy.stop))
        # blank out any neighbouring specimen that intrudes on the crop
        sub = (lab[sy, sx] == idx)
        pa = np.array(piece.split()[3]); pa[~sub] = 0
        piece.putalpha(Image.fromarray(pa))
        kept += 1
        name = f"{r['slug']}-{kept:02d}.png"
        piece.save(os.path.join(OUT, name))
        out.append({"source": r["slug"], "name": clean(r["name"]), "file": name,
                    "px_w": w, "px_h": h})
    tally.append(kept)

with open("scans_split_manifest.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=["source", "name", "file", "px_w", "px_h"])
    w.writeheader(); w.writerows(out)

t = np.array(tally)
print(f"sheets processed : {len(tally)}")
print(f"specimens cut    : {len(out)}")
print(f"per sheet        : min {t.min()}  median {int(np.median(t))}  max {t.max()}")
hs = np.array([o["px_h"] for o in out])
print(f"piece height px  : min {hs.min()}  median {int(np.median(hs))}  max {hs.max()}")
