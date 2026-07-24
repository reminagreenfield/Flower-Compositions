"""Index a category's asset list (no downloads) -> <stage>/_index.csv"""
import re, csv, time, os, sys, urllib.request, html as htmllib
UA={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
cat,stage=sys.argv[1],sys.argv[2]
BASE=f"https://www.scanslibrary.com/library?category={cat}"
os.makedirs(stage,exist_ok=True)
def get(u):
    with urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=60) as r:
        return r.read().decode("utf-8","replace")
CARD=re.compile(r'data-texture="(?P<slug>[^"]+)".*?data-background-image="(?P<img>[^"]+)".*?class="texture-name[^"]*">(?P<name>.*?)</span>\s*</span>',re.S)
def clean(n):
    n=" ".join(htmllib.unescape(re.sub(r"<[^>]+>","",n)).split())
    return n[:-5].strip() if n.endswith("1 Cr") else n
rows,seen,page=[],set(),1
while True:
    h=get(BASE if page==1 else f"{BASE}&page={page}")
    found=0
    for m in CARD.finditer(h):
        s=m.group("slug")
        if s in seen: continue
        seen.add(s); found+=1
        rows.append({"slug":s,"name":clean(m.group("name")),"url":m.group("img")})
    if found: print(f"page {page}: {found}  (running {len(rows)})")
    if found==0 or not re.search(rf'page={page+1}\b',h): break
    page+=1; time.sleep(0.6)
with open(os.path.join(stage,"_index.csv"),"w",newline="",encoding="utf-8") as f:
    w=csv.DictWriter(f,fieldnames=["slug","name","url"]); w.writeheader(); w.writerows(rows)
print(f"TOTAL {len(rows)} assets across {page} pages")
