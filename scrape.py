"""Pull the flower atlases from ScansLibrary into scans/ + scans_manifest.csv."""
import re, csv, time, os, urllib.request, html as htmllib

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
BASE = "https://www.scanslibrary.com/library?category=flowers"
OUT = "scans"
os.makedirs(OUT, exist_ok=True)

def get(url, binary=False):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read() if binary else r.read().decode("utf-8", "replace")

# each card: data-texture slug ... data-background-image URL ... texture-name NAME
CARD = re.compile(
    r'data-texture="(?P<slug>[^"]+)".*?'
    r'data-background-image="(?P<img>[^"]+)".*?'
    r'class="texture-name[^"]*">(?P<name>.*?)</span>\s*</span>',
    re.S)

rows, seen = [], set()
for page in range(1, 6):
    url = BASE if page == 1 else f"{BASE}&page={page}"
    h = get(url)
    found = 0
    for m in CARD.finditer(h):
        slug, img = m.group("slug"), m.group("img")
        name = htmllib.unescape(re.sub(r"<[^>]+>", "", m.group("name"))).strip()
        if slug in seen:
            continue
        seen.add(slug); found += 1
        rows.append({"slug": slug, "name": name, "url": img})
    print(f"page {page}: {found} assets")
    time.sleep(1.0)          # be gentle

print(f"total unique assets: {len(rows)}")

ok = fail = skip = 0
for i, r in enumerate(rows, 1):
    ext = os.path.splitext(r["url"])[1].lower() or ".png"
    path = os.path.join(OUT, r["slug"] + ext)
    r["file"] = os.path.basename(path)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        skip += 1; continue
    try:
        data = get(r["url"], binary=True)
        with open(path, "wb") as f:
            f.write(data)
        ok += 1
    except Exception as e:
        r["file"] = ""; fail += 1
        print("  FAIL", r["slug"], e)
    if i % 25 == 0:
        print(f"  {i}/{len(rows)} downloaded")
    time.sleep(0.35)

with open("scans_manifest.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=["slug", "name", "file", "url"])
    w.writeheader(); w.writerows(rows)

print(f"downloaded {ok}, already had {skip}, failed {fail}")
