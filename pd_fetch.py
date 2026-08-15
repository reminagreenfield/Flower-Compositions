"""Download full-res images listed in pd_<set>_index.csv into <set>/ folders.
Resumable (skips files already present), rate-limited, writes a manifest."""
import csv, os, re, sys, time, urllib.request
UA={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
CDN="https://images.pdimagearchive.org"
def slug(s):
    return re.sub(r"[^a-z0-9]+","-",(s or "untitled").lower()).strip("-")[:60] or "untitled"
def fetch(setname):
    os.makedirs(setname,exist_ok=True)
    rows=list(csv.DictReader(open(f"pd_{setname}_index.csv",encoding="utf-8")))
    man=[]; ok=skip=fail=0
    for i,r in enumerate(rows,1):
        if r["restriction"]:   # never auto-grab a flagged image
            man.append({**r,"file":"","status":"skipped-restricted"}); continue
        ext=os.path.splitext(r["src"])[1].lower() or ".jpg"
        fn=f"{slug(r['title'])}__{r['uuid'][:8]}{ext}"
        path=os.path.join(setname,fn)
        r2={"file":fn,"uuid":r["uuid"],"title":r["title"],"artist":r["artist"],
            "date":r["date"],"w":r["w"],"h":r["h"],"tags":r["tags"],"status":""}
        if os.path.exists(path) and os.path.getsize(path)>0:
            r2["status"]="have"; skip+=1; man.append(r2)
            if i%200==0: print(f"  {setname} {i}/{len(rows)}",flush=True)
            continue
        try:
            with urllib.request.urlopen(urllib.request.Request(CDN+r["src"],headers=UA),timeout=120) as resp:
                data=resp.read()
            open(path,"wb").write(data); ok+=1; r2["status"]="ok"
        except Exception as e:
            fail+=1; r2["status"]=f"fail:{str(e)[:40]}"; print("  FAIL",r["uuid"],str(e)[:50],flush=True)
        man.append(r2)
        if i%50==0: print(f"  {setname} {i}/{len(rows)}  ok={ok} skip={skip} fail={fail}",flush=True)
        time.sleep(0.3)
    with open(f"pd_{setname}_manifest.csv","w",newline="",encoding="utf-8") as f:
        w=csv.DictWriter(f,fieldnames=["file","uuid","title","artist","date","w","h","tags","status"])
        w.writeheader(); w.writerows(man)
    print(f"==> {setname}: downloaded {ok}, already had {skip}, failed {fail}",flush=True)
for s in (sys.argv[1:] or ["botanical","celestial"]): fetch(s)
