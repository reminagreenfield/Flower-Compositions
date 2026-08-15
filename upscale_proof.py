"""Real-ESRGAN x4 proof on 10 split scans. Model input is fixed 64x64, so
tile with overlap and feather-blend; alpha is upscaled separately (Lanczos)
since the model is RGB-only. Produces _stage_upscale/ + a comparison sheet."""
import os, numpy as np, onnxruntime as ort
from PIL import Image

SESS = ort.InferenceSession("_models/realesrgan_x4.onnx", providers=["CPUExecutionProvider"])
IN = SESS.get_inputs()[0].name
T, OV, SCALE = 64, 16, 4                 # tile, overlap, upscale factor
os.makedirs("_stage_upscale", exist_ok=True)

def run_tile(rgb):                       # rgb: HxWx3 float [0,1] exactly 64x64
    x = rgb.transpose(2, 0, 1)[None].astype(np.float32)
    y = SESS.run(None, {IN: x})[0][0]
    return np.clip(y.transpose(1, 2, 0), 0, 1)

def upscale_rgb(rgb):                     # rgb: HxWx3 float [0,1], any size
    h, w = rgb.shape[:2]
    step = T - OV
    pad_h = (-(h - T) % step) if h > T else T - h
    pad_w = (-(w - T) % step) if w > T else T - w
    p = np.pad(rgb, ((0, pad_h), (0, pad_w), (0, 0)), mode="edge")
    H, W = p.shape[:2]
    out = np.zeros((H * SCALE, W * SCALE, 3), np.float32)
    acc = np.zeros((H * SCALE, W * SCALE, 1), np.float32)
    # feather weight so overlapping tiles blend without seams
    r = np.linspace(0, np.pi, T * SCALE)
    win = np.outer(np.sin(r), np.sin(r))[..., None] + 1e-3
    for ty in range(0, H - T + 1, step):
        for tx in range(0, W - T + 1, step):
            up = run_tile(p[ty:ty+T, tx:tx+T])
            oy, ox = ty * SCALE, tx * SCALE
            out[oy:oy+T*SCALE, ox:ox+T*SCALE] += up * win
            acc[oy:oy+T*SCALE, ox:ox+T*SCALE] += win
    res = out / acc
    return res[:h*SCALE, :w*SCALE]

def upscale_png(path):
    im = Image.open(path).convert("RGBA")
    arr = np.asarray(im, np.float32) / 255.0
    rgb, a = arr[..., :3], arr[..., 3:]
    big_rgb = upscale_rgb(rgb)
    big_a = np.asarray(Image.fromarray((a[..., 0]*255).astype(np.uint8))
                       .resize((im.width*SCALE, im.height*SCALE), Image.LANCZOS), np.float32)/255.0
    out = np.dstack([np.clip(big_rgb,0,1), big_a[..., None]])
    return im, Image.fromarray((out*255).astype(np.uint8), "RGBA")

files = [l.strip() for l in open("_stage_upscale_pick.txt") if l.strip()]
pad = Image.new("RGBA", (1,1))
rows = []
import time
for f in files:
    t0 = time.time()
    orig, big = upscale_png(os.path.join("scans_split", f))
    big.save(os.path.join("_stage_upscale", f))
    rows.append((f, orig, big, time.time()-t0))
    print(f"{f:38} {orig.width}x{orig.height} -> {big.width}x{big.height}  {time.time()-t0:.1f}s", flush=True)

# comparison sheet: each row = original(Lanczos to match height) | ESRGAN, at 3x display
DISP = 3
cellH = max(o.height for _,o,_,_ in rows) * DISP
sheet = Image.new("RGBA", (0,0))
W = 0
cells = []
for f,o,b,_ in rows:
    dh = o.height*DISP
    lanc = o.resize((o.width*DISP, dh), Image.LANCZOS)
    esr  = b.resize((b.width*DISP//SCALE, dh), Image.LANCZOS)   # b is 4x; show at same display height
    gap = 12
    cw = lanc.width + gap + esr.width + 30
    cell = Image.new("RGBA",(cw, cellH+30),(245,244,238,255))
    cell.paste(lanc,(10,15),lanc)
    cell.paste(esr,(10+lanc.width+gap,15),esr)
    cells.append(cell); W=max(W,cw)
sheetH = sum(c.height for c in cells)
sheet = Image.new("RGBA",(W, sheetH),(245,244,238,255))
y=0
for c in cells: sheet.paste(c,(0,y)); y+=c.height
sheet.convert("RGB").save("_stage_upscale/_compare.jpg", quality=88)
print("comparison sheet written (left=Lanczos, right=Real-ESRGAN, same display size)")
