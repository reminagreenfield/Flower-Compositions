"""CLIP zero-shot gate + kept-sheet. Shared by the extractor and for review."""
import numpy as np, torch, open_clip
from PIL import Image

_M=None
def _load():
    global _M
    if _M is None:
        model,_,pre=open_clip.create_model_and_transforms("ViT-B-32",pretrained="openai")
        model.eval(); tok=open_clip.get_tokenizer("ViT-B-32")
        _M=(model,pre,tok)
    return _M

POS={"plant":["a botanical illustration of a plant","a drawing of a flower",
     "a pressed plant specimen","a leaf","a branch with leaves","a fern","seaweed"],
 "animal":["an illustration of an animal","a drawing of a bird","a fish","an insect",
     "a mammal","a reptile","a butterfly","a shell"]}
NEG=["a decorative frame or border","an ornamental cartouche","a person","a human figure",
     "a group of people","a landscape scene","a building or architecture","a diagram or chart",
     "a page of text","an empty picture frame","a mineral or rock specimen","a carved gem or coin"]

def make_gate(category):
    model,pre,tok=_load()
    prompts=POS[category]+NEG+(["an animal"] if category=="plant" else ["a plant or flower"])
    with torch.no_grad():
        tf=model.encode_text(tok(prompts)); tf/=tf.norm(dim=-1,keepdim=True)
    npos=len(POS[category])
    def score(pil_rgba):
        bg=Image.new("RGB",pil_rgba.size,(255,255,255)); bg.paste(pil_rgba,(0,0),pil_rgba)
        x=pre(bg).unsqueeze(0)
        with torch.no_grad():
            f=model.encode_image(x); f/=f.norm(dim=-1,keepdim=True)
            p=(100*f@tf.T).softmax(dim=-1)[0].numpy()
        return float(p[:npos].sum())
    return score
