"""Scrape one ScansLibrary category into a staging folder.

  python scrape_category.py <category> <staging_dir>
"""
import re, csv, time, os, sys, urllib.request, html as htmllib

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
cat, stage = sys.argv[1], sys.argv[2]
BASE = f"https://www.scanslibrary.com/library?category={cat}"
os.makedirs(stage, exist_ok=True)

def get(url, binary=False):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read() if binary else r.read().decode("utf-8", "replace")

CARD = re.compile(
    r'data-texture="(?P<slug>[^"]+)".*?'
    r'data-background-image="(?P<img>[^"]+)".*?'
    r'class="texture-name[^"]*">(?P<name>.*?)</span>\s*</span>', re.S)

def clean(n):
    n = " ".join(htmllib.unescape(re.sub(r"<[^>]+>", "", n)).split())
    return n[:-5].strip() if n.endswith("1 Cr") else n

rows, seen, page = [], set(), 1
while True:
    url = BASE if page == 1 else f"{BASE}&page={page}"
    h = get(url)
    found = 0
    for m in CARD.finditer(h):
        s = m.group("slug")
        if s in seen: continue
        seen.add(s); found += 1
        rows.append({"slug": s, "name": clean(m.group("name")), "url": m.group("img")})
    print(f"page {page}: {found} assets")
    if found == 0: break
    if not re.search(rf'page={page+1}\b', h): break
    page += 1; time.sleep(1.0)

print(f"total unique: {len(rows)}")
ok = fail = 0
for i, r in enumerate(rows, 1):
    ext = os.path.splitext(r["url"])[1].lower() or ".png"
    p = os.path.join(stage, r["slug"] + ext)
    r["file"] = os.path.basename(p)
    if os.path.exists(p) and os.path.getsize(p): ok += 1; continue
    try:
        open(p, "wb").write(get(r["url"], binary=True)); ok += 1
    except Exception as e:
        r["file"] = ""; fail += 1; print("  FAIL", r["slug"], e)
    if i % 25 == 0: print(f"  {i}/{len(rows)}")
    time.sleep(0.35)

with open(os.path.join(stage, "_manifest.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=["slug", "name", "file", "url"])
    w.writeheader(); w.writerows(rows)
print(f"downloaded {ok}, failed {fail}")
