"""Cut large, central subjects out of the public-domain plates as transparent PNGs.

Uses rembg (salient-object segmentation) to get a foreground mask, then keeps
only components that are big + reasonably central + solid — rejecting scenes,
diagrams, plans, frames, text pages and sparse line art. "Each large form" is
saved separately (touching subjects stay one blob).

  python extract_cutouts.py <src> <out> [--sample N] [--sheet]
"""
import os, sys, csv, numpy as np
from PIL import Image
from scipy import ndimage
from rembg import remove, new_session

SRC=sys.argv[1]; OUT=sys.argv[2]
sample=None; make_sheet=False; category=None; THR=0.55
if "--sample" in sys.argv: sample=int(sys.argv[sys.argv.index("--sample")+1])
if "--sheet" in sys.argv: make_sheet=True
if "--classify" in sys.argv: category=sys.argv[sys.argv.index("--classify")+1]   # plant|animal
if "--thr" in sys.argv: THR=float(sys.argv[sys.argv.index("--thr")+1])
os.makedirs(OUT,exist_ok=True)
LOW=os.path.join(OUT,"_low"); os.makedirs(LOW,exist_ok=True)   # near-misses, not deleted
SESSION=new_session("isnet-general-use")
gate=None
if category:
    from clip_gate import make_gate; gate=make_gate(category)

MASK_MAX=1000            # downscale for masking; mask is scaled back up to full res
def mask_of(im):
    small=im.copy(); small.thumbnail((MASK_MAX,MASK_MAX))
    cut=remove(small,session=SESSION,post_process_mask=True)
    a=np.asarray(cut.split()[3])
    return a, small.size

# strict keep rule
MIN_AREA_FRAC=0.06       # component must be >=6% of the plate
MIN_DIM_FRAC=0.32        # ...and span >=32% of a side (i.e. actually "big")
MAX_FG_FRAC=0.90         # whole-frame foreground => scene/pattern, reject
MIN_SOLIDITY=0.18        # bbox fill; drops scattered specks & sparse line art
CENTRAL=0.80             # centroid must sit within the central 80% box

def analyze(a):
    H,W=a.shape; tot=H*W
    m=a>40
    if m.mean()>MAX_FG_FRAC or m.mean()<0.02: return []
    m=ndimage.binary_closing(m,structure=np.ones((3,3)))
    lab,n=ndimage.label(m,structure=np.ones((3,3)))
    if not n: return []
    keep=[]
    for i in range(1,n+1):
        ys,xs=np.where(lab==i)
        area=len(ys); 
        if area/tot<MIN_AREA_FRAC: continue
        y0,y1,x0,x1=ys.min(),ys.max(),xs.min(),xs.max()
        bh,bw=y1-y0+1,x1-x0+1
        if bh/H<MIN_DIM_FRAC and bw/W<MIN_DIM_FRAC: continue
        if area/(bh*bw)<MIN_SOLIDITY: continue
        cy,cx=(y0+y1)/2/H,(x0+x1)/2/W
        if not (0.5-CENTRAL/2<cx<0.5+CENTRAL/2 and 0.5-CENTRAL/2<cy<0.5+CENTRAL/2): continue
        # reject a component that hugs all four edges (background/border)
        if x0<=1 and x1>=W-2 and y0<=1 and y1>=H-2 and area/tot>0.6: continue
        keep.append((i,area,(y0,y1,x0,x1)))
    keep.sort(key=lambda k:-k[1])
    return keep,lab

def process(fn):
    im=Image.open(os.path.join(SRC,fn)).convert("RGBA")
    a_small,small_sz=mask_of(im)
    res=analyze(a_small)
    if not res: return {"file":fn,"kept":0,"reason":"no-dominant-form"}
    keep,lab=res
    # scale mask up to full res
    full=np.asarray(Image.fromarray(lab.astype(np.int32)).resize(im.size,Image.NEAREST))
    W,H=im.size; arr=np.asarray(im); saved=[]; low=0; scores=[]
    base=os.path.splitext(fn)[0]
    for k,(idx,area,_) in enumerate(keep,1):
        sub=full==idx
        ys,xs=np.where(sub); y0,y1,x0,x1=ys.min(),ys.max(),xs.min(),xs.max()
        crop=arr[y0:y1+1,x0:x1+1].copy()
        cm=sub[y0:y1+1,x0:x1+1]
        crop[...,3]=np.where(cm,crop[...,3],0)
        cut=Image.fromarray(crop,"RGBA")
        name=f"{base}__cut{k}.png" if len(keep)>1 else f"{base}__cut.png"
        s=gate(cut) if gate else 1.0
        scores.append(f"{s:.2f}")
        if s>=THR:
            cut.save(os.path.join(OUT,name)); saved.append(name)
        else:
            cut.save(os.path.join(LOW,name)); low+=1
    return {"file":fn,"kept":len(saved),"low":low,"reason":"ok",
            "scores":";".join(scores),"names":";".join(saved)}

files=sorted(f for f in os.listdir(SRC) if not f.startswith("_") and f.lower().endswith((".jpg",".jpeg",".png")))
if sample:
    import random; random.seed(7); files=random.sample(files,min(sample,len(files)))
# resumable: skip plates already recorded in the report
REPORT=os.path.join(OUT,"_report.csv")
done=set()
if os.path.exists(REPORT):
    for r in csv.DictReader(open(REPORT,encoding="utf-8")): done.add(r["file"])
todo=[f for f in files if f not in done]
print(f"{SRC}: {len(files)} plates, {len(done)} already done, {len(todo)} to do",flush=True)
newfields=["file","kept","low","reason","scores","names"]
first=not os.path.exists(REPORT)
f=open(REPORT,"a",newline="",encoding="utf-8"); w=csv.DictWriter(f,fieldnames=newfields)
if first: w.writeheader()
kept=lowc=0
for i,fn in enumerate(todo,1):
    try: r=process(fn)
    except Exception as e: r={"file":fn,"kept":0,"low":0,"reason":f"err:{str(e)[:40]}"}
    w.writerow({k:r.get(k,"") for k in newfields}); f.flush()
    kept+=r["kept"]; lowc+=r.get("low",0)
    if i%25==0: print(f"  {i}/{len(todo)}  kept {kept}, low {lowc}",flush=True)
f.close()
print(f"==> {SRC}: kept {kept} cut-outs, {lowc} near-misses in _low/",flush=True)

if make_sheet:
    cuts=[f for f in os.listdir(OUT) if f.endswith(".png")][:40]
    C=5; TW=TH=260
    def checker(w,h):
        t=np.zeros((h,w,3),np.uint8); s=16
        for y in range(0,h,s):
            for x in range(0,w,s):
                t[y:y+s,x:x+s]=230 if ((x//s+y//s)%2) else 200
        return Image.fromarray(t)
    rows2=(len(cuts)+C-1)//C
    sheet=Image.new("RGB",(C*TW,rows2*TH),(245,244,238))
    for i,f in enumerate(cuts):
        im=Image.open(os.path.join(OUT,f)).convert("RGBA"); im.thumbnail((TW-12,TH-12))
        bg=checker(im.width,im.height); bg.paste(im,(0,0),im)
        sheet.paste(bg,((i%C)*TW+6,(i//C)*TH+6))
    sheet.save(os.path.join(OUT,"_sheet.jpg"),quality=85)
    print("sheet written",flush=True)
