"""
Flower clip-art pipeline for Flower Canvas Studio
--------------------------------------------------
One-time script. For each dried-flower product it:
  1. downloads the main product photo
  2. removes the background -> transparent PNG
  3. records the product name + typical real height (cm) in manifest.csv
Then you upload each PNG into the studio app with its height from the manifest.

Setup (once):
    pip install requests beautifulsoup4 rembg pillow onnxruntime

Note: check the shop's Terms of Service before scraping, and keep the
images for your own private design mockups only — product photos are
copyrighted. The gentler alternative: right-click-save the 91 images
manually (or photograph your own purchased stems next to a ruler —
best accuracy, zero rights questions) and run only Step 2 on a folder.

Usage:
    python make_flower_assets.py scrape          # crawl category pages, download photos
    python make_flower_assets.py cut  ./raw      # background-remove every image in ./raw
    python make_flower_assets.py palette         # sample 5 dominant colors per PNG in assets/
"""

import csv, io, re, sys, time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE = "https://abraflora.com"
CATEGORIES = [
    f"{BASE}/product-category/dried-flowers/",
    f"{BASE}/product-category/dried-foliage/",
]
RAW = Path("raw"); RAW.mkdir(exist_ok=True)
OUT = Path("assets"); OUT.mkdir(exist_ok=True)
HEADERS = {"User-Agent": "Mozilla/5.0 (personal design-mockup tool; low volume)"}

# Fallback real heights (cm) by keyword, used when the listing doesn't state one.
# Adjust to what actually arrives at your studio.
TYPICAL_CM = {
    "pampas": 90, "eucalyptus": 55, "lavender": 42, "craspedia": 60,
    "billy": 60, "bunny": 50, "rose": 35, "fern": 45, "protea": 40,
    "nigella": 40, "thistle": 55, "oat": 60, "grass": 60, "palm": 70,
    "ruscus": 60, "statice": 50, "wheat": 60, "poppy": 45, "lotus": 30,
}
def guess_height(name: str) -> int:
    n = name.lower()
    for k, v in TYPICAL_CM.items():
        if k in n:
            return v
    return 50

def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60]

def product_links():
    seen = set()
    for cat in CATEGORIES:
        page = 1
        while True:
            url = cat if page == 1 else f"{cat}page/{page}/"
            r = requests.get(url, headers=HEADERS, timeout=30)
            if r.status_code != 200:
                break
            soup = BeautifulSoup(r.text, "html.parser")
            links = {a["href"] for a in soup.select("a[href*='/product/']") if a.get("href")}
            new = links - seen
            if not new:
                break
            seen |= new
            page += 1
            time.sleep(1.5)  # be polite
    return sorted(seen)

def scrape():
    rows = []
    for url in product_links():
        try:
            r = requests.get(url, headers=HEADERS, timeout=30)
            soup = BeautifulSoup(r.text, "html.parser")
            name = (soup.select_one("h1") or soup.title).get_text(strip=True)
            img = soup.select_one(".woocommerce-product-gallery img") or soup.select_one("img.wp-post-image")
            src = img.get("data-src") or img.get("src") if img else None
            if not src:
                continue
            data = requests.get(src, headers=HEADERS, timeout=30).content
            fn = RAW / f"{slug(name)}.jpg"
            fn.write_bytes(data)
            # try to find a stated length like 24" or 60cm in the page text
            text = soup.get_text(" ")
            m = re.search(r"(\d{1,3})\s*(?:cm|centimeters)", text, re.I)
            mi = re.search(r"(\d{1,2})\s*(?:\"|inch)", text, re.I)
            h = int(m.group(1)) if m else (round(int(mi.group(1)) * 2.54) if mi else guess_height(name))
            rows.append([name, fn.name, h])
            print(f"OK {name}  (~{h} cm)")
            time.sleep(1.5)
        except Exception as e:
            print(f"!! {url}: {e}")
    with open("manifest.csv", "w", newline="") as f:
        csv.writer(f).writerows([["name", "file", "height_cm"], *rows])
    print(f"\n{len(rows)} products saved to ./raw + manifest.csv")

def cut(folder: str):
    from rembg import remove
    from PIL import Image
    for p in sorted(Path(folder).glob("*")):
        if p.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
            continue
        img = Image.open(p).convert("RGBA")
        out = remove(img)                      # AI background removal
        bbox = out.getbbox()                   # crop to the flower itself
        if bbox:
            out = out.crop(bbox)
        dest = OUT / f"{p.stem}.png"
        out.save(dest)
        print(f"OK {dest}")
    print(f"\nTransparent PNGs in ./{OUT} — upload each into the studio app "
          f"with its height_cm from manifest.csv")

def dominant_colors(png_path, n=5):
    """Return n dominant hex colors from a transparent PNG, ignoring fully transparent pixels."""
    from PIL import Image
    img = Image.open(png_path).convert("RGBA")
    # Shrink large images for speed before sampling
    max_side = 300
    if max(img.size) > max_side:
        img.thumbnail((max_side, max_side), Image.LANCZOS)
    # Collect only visible pixels (alpha > 0) as RGB tuples
    pixels = [px[:3] for px in img.get_flattened_data() if px[3] > 0]
    if not pixels:
        return ["#000000"] * n
    # Build a 1×w RGB image from visible pixels so Pillow can quantize them
    w = len(pixels)
    flat = Image.new("RGB", (w, 1))
    flat.putdata(pixels)
    quantized = flat.quantize(colors=n, method=Image.Quantize.MEDIANCUT)
    pal = quantized.getpalette()[:n * 3]
    return [f"#{pal[i*3]:02x}{pal[i*3+1]:02x}{pal[i*3+2]:02x}" for i in range(n)]

def palette():
    """Sample 5 dominant colors for each PNG in assets/ and write them into manifest.csv."""
    from PIL import Image  # ensure Pillow is importable before we start
    manifest = Path("manifest.csv")
    if not manifest.exists():
        print("manifest.csv not found — run scrape first.")
        return

    # Read existing manifest
    with open(manifest, newline="", encoding="cp1252") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        base_fields = reader.fieldnames or ["name", "file", "height_cm"]

    palette_fields = [f"palette{i}" for i in range(1, 6)]
    out_fields = [f for f in base_fields if f not in palette_fields] + palette_fields

    updated = 0
    skipped = 0
    for row in rows:
        stem = Path(row["file"]).stem          # e.g. "agrostis-grass-purple"
        png = OUT / f"{stem}.png"
        if not png.exists():
            for field in palette_fields:
                row[field] = ""
            skipped += 1
            continue
        try:
            colors = dominant_colors(png)
            for i, field in enumerate(palette_fields):
                row[field] = colors[i]
            print(f"OK {stem:50s}  {' '.join(colors)}")
            updated += 1
        except Exception as e:
            print(f"!! {stem}: {e}")
            for field in palette_fields:
                row[field] = ""

    with open(manifest, "w", newline="", encoding="cp1252") as f:
        writer = csv.DictWriter(f, fieldnames=out_fields)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\n{updated} flowers colored, {skipped} skipped (no PNG). manifest.csv updated.")

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "scrape"
    if cmd == "scrape":
        scrape()
    elif cmd == "cut":
        cut(sys.argv[2] if len(sys.argv) > 2 else "raw")
    elif cmd == "palette":
        palette()
    else:
        print(f"Unknown command: {cmd}. Use scrape, cut, or palette.")
