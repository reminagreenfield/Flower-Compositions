"""Download only assets from <stage>/_index.csv whose slug isn't already in scans_manifest.csv."""
import csv, os, sys, time, urllib.request
UA={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
stage=sys.argv[1]
idx=list(csv.DictReader(open(os.path.join(stage,"_index.csv"),encoding="utf-8")))
have={r["slug"] for r in csv.DictReader(open("scans_manifest.csv",encoding="utf-8"))}
todo=[r for r in idx if r["slug"] not in have]
print(f"skipping {len(idx)-len(todo)} already-downloaded, fetching {len(todo)}",flush=True)
rows=[];ok=fail=0
for i,r in enumerate(todo,1):
    ext=os.path.splitext(r["url"])[1].lower() or ".png"
    p=os.path.join(stage,r["slug"]+ext)
    r=dict(r); r["file"]=os.path.basename(p)
    if not(os.path.exists(p) and os.path.getsize(p)):
        try:
            with urllib.request.urlopen(urllib.request.Request(r["url"],headers=UA),timeout=60) as resp:
                open(p,"wb").write(resp.read())
            ok+=1
        except Exception as e:
            r["file"]="";fail+=1;print("  FAIL",r["slug"],e,flush=True)
    else: ok+=1
    rows.append(r)
    if i%100==0: print(f"  {i}/{len(todo)}",flush=True)
    time.sleep(0.3)
with open(os.path.join(stage,"_manifest.csv"),"w",newline="",encoding="utf-8") as f:
    w=csv.DictWriter(f,fieldnames=["slug","name","file","url"]);w.writeheader()
    w.writerows([{k:r[k] for k in w.fieldnames} for r in rows])
print(f"done: {ok} ok, {fail} failed",flush=True)
