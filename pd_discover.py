"""Index (no image downloads) the botanical + celestial sets from the
Public Domain Image Archive gallery JSON API. Dedupe by uuid, capture
full-res dimensions and any reuse restrictions, write one CSV per set."""
import urllib.request, json, csv, time, sys

UA={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
API="https://pdimagearchive.org/api/galleries/tags/{tag}/{page}.json"

SETS={
 "botanical":["botanical","plants","flowers","flora","floral","botany","trees",
   "leaves","foliage","herbals","herbs","gardens","wildflowers","botanical-art",
   "botanical-illustration","botanical-drawing","plant-photography","climbing-plants"],
 "celestial":["celestial","astronomy","stars","moon","sun","space","sky",
   "astrology","zodiac"],
 # monsters: creatures/demonic/supernatural, deduped by uuid. Excludes broad
 # "mythology"/"myth" (gods & heroes) and false-friend tags (shells, shelley,
 # dragonflies, seashells).
 "monsters":["monsters","sea-monsters","demons","demonology","demonic","devils",
   "devil","grotesques","grotesque","gargoyles","human-animal-hybrid","animal-hybrid",
   "hybrid-figures","bestiary","creatures","fantastical-creatures","mythological-creatures",
   "sea-creatures","winged-creatures","beasts","serpents","serpentine","sea-serpents",
   "dragons","chimera","goblins","ghosts","ghostly","supernatural","witches","witchcraft","hell"],
}

def get(url):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers=UA),timeout=45) as r:
                return json.load(r)
        except Exception as e:
            if attempt==2: raise
            time.sleep(2)

def restriction(img):
    # surface any geo/attribution flag the archive marks; keys vary, so scan broadly
    flags=[]
    for k,v in img.items():
        lk=k.lower()
        if any(t in lk for t in ("restrict","geo","attribut","rights","licen","reuse")) and v:
            flags.append(f"{k}={v}")
    return "; ".join(flags)

want=sys.argv[1:] or list(SETS)
for setname,tags in SETS.items():
    if setname not in want: continue
    seen={}
    for tag in tags:
        p1=get(API.format(tag=tag,page=1))
        total=p1["pagination"]["totalPages"]
        pages=[p1]+[get(API.format(tag=tag,page=n)) for n in range(2,total+1)]
        cnt=0
        for pg in pages:
            for img in pg["images"]:
                cnt+=1
                u=img["uuid"]
                if u in seen: 
                    seen[u]["tags"].add(tag); continue
                seen[u]={"uuid":u,"title":img.get("title",""),
                    "artist":"; ".join(a["label"] for a in img.get("artists",[])),
                    "date":img.get("displayDate",""),"src":img.get("src",""),
                    "w":img.get("width",""),"h":img.get("height",""),
                    "restriction":restriction(img),"tags":{tag}}
            time.sleep(0.25)
        print(f"[{setname}] {tag:24} {cnt:4} imgs  (unique so far {len(seen)})",flush=True)
    rows=list(seen.values())
    for r in rows: r["tags"]=",".join(sorted(r["tags"]))
    with open(f"pd_{setname}_index.csv","w",newline="",encoding="utf-8") as f:
        w=csv.DictWriter(f,fieldnames=["uuid","title","artist","date","src","w","h","restriction","tags"])
        w.writeheader(); w.writerows(rows)
    import os
    mb=sum(int(r["w"] or 0)*int(r["h"] or 0) for r in rows)*3/1e6/8  # very rough jpeg est
    restricted=sum(1 for r in rows if r["restriction"])
    print(f"==> {setname}: {len(rows)} unique images, {restricted} flagged w/ restriction, ~{mb/1000:.1f} GB est\n",flush=True)
