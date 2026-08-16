import os,sys
from PIL import Image
from clip_gate import make_gate
folder,category=sys.argv[1],sys.argv[2]; THR=float(sys.argv[3]) if len(sys.argv)>3 else 0.5
gate=make_gate(category)
files=sorted(f for f in os.listdir(folder) if f.endswith(".png"))
kept=[f for f in files if gate(Image.open(os.path.join(folder,f)).convert("RGBA"))>=THR]
print(f"{folder}: kept {len(kept)}/{len(files)} at thr {THR}")
import numpy as np
def checker(w,h,s=14):
    t=np.zeros((h,w,3),np.uint8)
    for y in range(0,h,s):
        for x in range(0,w,s): t[y:y+s,x:x+s]=232 if ((x//s+y//s)%2) else 205
    return Image.fromarray(t)
C=5;TW=TH=260;rows=(len(kept)+C-1)//C or 1
sheet=Image.new("RGB",(C*TW,rows*TH),(245,244,238))
for i,f in enumerate(kept):
    im=Image.open(os.path.join(folder,f)).convert("RGBA"); im.thumbnail((TW-12,TH-12))
    bg=checker(im.width,im.height); bg.paste(im,(0,0),im)
    sheet.paste(bg,((i%C)*TW+6,(i//C)*TH+6))
sheet.save(os.path.join(folder,"_kept_sheet.jpg"),quality=85)
print("wrote",os.path.join(folder,"_kept_sheet.jpg"))
