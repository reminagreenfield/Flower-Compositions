"""Zero-shot CLIP gate: is a cut-out actually a plant (botanical) or animal?
Scores each PNG in a folder and prints keep/reject at a threshold."""
import os, sys, numpy as np, torch, open_clip
from PIL import Image

folder=sys.argv[1]; category=sys.argv[2]   # "plant" or "animal"
THR=float(sys.argv[3]) if len(sys.argv)>3 else 0.55

model,_,pre=open_clip.create_model_and_transforms("ViT-B-32",pretrained="openai")
tok=open_clip.get_tokenizer("ViT-B-32"); model.eval()

POS={"plant":["a botanical illustration of a plant","a drawing of a flower",
     "a pressed plant specimen","a leaf","a branch with leaves","a fern","seaweed"],
 "animal":["an illustration of an animal","a drawing of a bird","a fish","an insect",
     "a mammal","a reptile","a butterfly"]}
NEG=["a decorative frame or border","an ornamental cartouche","a person","a human figure",
     "a group of people","a landscape scene","a building or architecture","a diagram or chart",
     "a page of text","an empty picture frame"]
if category=="plant": NEG=NEG+["an animal"]
else: NEG=NEG+["a plant or flower"]

prompts=POS[category]+NEG
with torch.no_grad():
    tfeat=model.encode_text(tok(prompts)); tfeat/=tfeat.norm(dim=-1,keepdim=True)
npos=len(POS[category])

def score(path):
    im=Image.open(path).convert("RGBA")
    bg=Image.new("RGB",im.size,(255,255,255)); bg.paste(im,(0,0),im)
    x=pre(bg).unsqueeze(0)
    with torch.no_grad():
        f=model.encode_image(x); f/=f.norm(dim=-1,keepdim=True)
        p=(100*f@tfeat.T).softmax(dim=-1)[0].numpy()
    return float(p[:npos].sum())

files=sorted(f for f in os.listdir(folder) if f.endswith(".png"))
res=[(f,score(os.path.join(folder,f))) for f in files]
keep=[r for r in res if r[1]>=THR]; rej=[r for r in res if r[1]<THR]
print(f"{folder}  category={category}  thr={THR}")
print(f"  KEEP {len(keep)}/{len(res)}")
for f,s in sorted(rej,key=lambda x:x[1]): print(f"   reject {s:.2f}  {f[:52]}")
print("  --- kept (low first) ---")
for f,s in sorted(keep,key=lambda x:x[1])[:12]: print(f"   keep   {s:.2f}  {f[:52]}")
