import { useState, useRef, useEffect, useMemo } from "react";

/* ============================================================
   FLOWER CANVAS STUDIO
   Design mockup tool for dried-flower + UV resin works on
   sheer mesh stretched over bars. All sizes are real-world cm.
   ============================================================ */

const PAINT_RES = 8;    // paint raster resolution, px per cm
const EXPORT_RES = 12;  // export resolution, px per cm

/* ── SVG PRIMITIVES ───────────────────────────────────────────── */
function svgWrap(w, h, inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${inner}</svg>`;
}
const stemPath = (x, topY, botY, sway, color, sw) =>
  `<path d="M ${x} ${botY} C ${x + sway} ${botY - (botY - topY) * 0.4}, ${x - sway} ${topY + (botY - topY) * 0.3}, ${x} ${topY}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`;

/* ── ARCHETYPE GENERATORS ─────────────────────────────────────── */
/* Each accepts a params object and returns { svg(variant, mono) } */
/* to be spread into an ASSETS entry.                              */
/*                                                                 */
/* Common params (all generators):                                 */
/*   palette       – string[] of hex colors, primary first         */
/*   stemColor     – hex for the stem / rachis                     */
/*   stemThickness – SVG stroke-width for the main stem            */
/*   density       – element count (florets, dots, strands, …)     */
/*   proportions   – archetype-specific sizing overrides (object)  */
/*   droop         – lateral sway applied to the stem bezier       */

/** spike – alternating paired florets tapering to a point.
 *  floretShape: "ellipse" (default) | "diamond"
 *  proportions: { floretW, floretH, spread, spacing } */
function spike({
  palette = ["#8A76BC", "#6A559E"],
  stemColor = "#7C8F5E",
  stemThickness = 3,
  density = 16,
  proportions: { floretW = 6, floretH = 4, spread = 16, spacing = 9 } = {},
  droop = 8,
  floretShape = "ellipse",
} = {}) {
  return {
    svg(variant, mono) {
      const c1 = mono || palette[0], c2 = mono || (palette[1] || palette[0]);
      const stem = mono || stemColor;
      const floret = (cx, cy, col, angle, s) => {
        const rx = floretW * s, ry = floretH * s;
        return floretShape === "diamond"
          ? `<polygon points="${cx},${cy - ry} ${cx + rx},${cy} ${cx},${cy + ry} ${cx - rx},${cy}" fill="${col}" transform="rotate(${angle} ${cx} ${cy})"/>`
          : `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${col}" transform="rotate(${angle} ${cx} ${cy})"/>`;
      };
      const body = (ox, oy, s) => {
        let f = "";
        for (let i = 0; i < density; i++) {
          const y = oy + i * spacing * s;
          const sp = (1 - i / (density + 2)) * spread * s + 4;
          f += floret(ox - sp, y,     i % 2 ? c1 : c2, -30, s);
          f += floret(ox + sp, y + 4, i % 2 ? c2 : c1,  30, s);
        }
        return f;
      };
      if (variant === "bud") return svgWrap(64, 400, body(32, 20, 2.4));
      return svgWrap(64, 400, stemPath(32, 150, 398, droop, stem, stemThickness) + body(32, 10, 0.95));
    },
  };
}

/** ball – spherical head with scattered dot florets on a stem.
 *  proportions: { headR, budHeadR, dotRMin, dotRMax, budDotRMin, budDotRMax } */
function ball({
  palette = ["#D9A521", "#E7B637", "#C4930F"],
  stemColor = "#7A8B52",
  stemThickness = 4,
  density = 60,
  proportions: {
    headR = 28, budHeadR = 48,
    dotRMin = 1.4, dotRMax = 2.4,
    budDotRMin = 2, budDotRMax = 4,
  } = {},
  droop = 16,
} = {}) {
  return {
    svg(variant, mono) {
      const base = mono || palette[0];
      const stem = mono || stemColor;
      if (variant === "bud") {
        let dots = "";
        for (let i = 0; i < density * 1.5; i++) {
          const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (budHeadR - 2);
          dots += `<circle cx="${50 + Math.cos(a) * r}" cy="${50 + Math.sin(a) * r}" r="${budDotRMin + Math.random() * (budDotRMax - budDotRMin)}" fill="${mono || (Math.random() > .5 ? palette[1] : palette[2])}"/>`;
        }
        return svgWrap(100, 100, `<circle cx="50" cy="50" r="${budHeadR}" fill="${base}"/>${dots}`);
      }
      let dots = "";
      for (let i = 0; i < density; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (headR - 2);
        dots += `<circle cx="${50 + Math.cos(a) * r}" cy="${30 + Math.sin(a) * r}" r="${dotRMin + Math.random() * (dotRMax - dotRMin)}" fill="${mono || palette[1]}"/>`;
      }
      return svgWrap(100, 455,
        stemPath(50, 56, 452, droop, stem, stemThickness) +
        `<circle cx="50" cy="30" r="${headR}" fill="${base}"/>` + dots);
    },
  };
}

/** plume – loose airy strands fanning from a central axis.
 *  proportions: { spread } – max lateral reach of strands in SVG px */
function plume({
  palette = ["#E4D3B8", "#D3BE9C"],
  stemColor = "#B9A57F",
  stemThickness = 3,
  density = 110,
  proportions: { spread = 52 } = {},
  droop = 6,
} = {}) {
  return {
    svg(variant, mono) {
      const c1 = mono || palette[0], c2 = mono || (palette[1] || palette[0]);
      const stem = mono || stemColor;
      const plumeBody = (h) => {
        let s = "";
        for (let i = 0; i < density; i++) {
          const t = Math.random(), y = 12 + t * h;
          const sp = Math.sin(Math.PI * Math.min(1, t + .05)) * spread + 6;
          const x = 66 + (Math.random() * 2 - 1) * sp;
          s += `<path d="M 66 ${y + 24} Q ${x} ${y + 10} ${x + (Math.random() * 14 - 7)} ${y - 8}" stroke="${Math.random() > .5 ? c1 : c2}" stroke-width="${1 + Math.random() * 1.6}" fill="none" opacity="${mono ? 1 : 0.6 + Math.random() * 0.4}" stroke-linecap="round"/>`;
        }
        return s;
      };
      if (variant === "bud") return svgWrap(132, 300, plumeBody(270));
      return svgWrap(132, 440, stemPath(66, 200, 438, droop, stem, stemThickness) + plumeBody(210));
    },
  };
}

/** leafyBranch – alternating leaves on petioles from a central stem.
 *  leafShape: "round" (default) | "oval"
 *  proportions: { leafR, spacing, offset } */
function leafyBranch({
  palette = ["#8FA48B", "#7C927A", "#9A8A6C"],
  stemColor = "#9A8A6C",
  stemThickness = 3.5,
  density = 9,
  proportions: { leafR = 20, spacing = 44, offset = 34 } = {},
  droop = 10,
  leafShape = "round",
} = {}) {
  return {
    svg(_variant, mono) {
      const l1 = mono || palette[0], l2 = mono || (palette[1] || palette[0]);
      const stem = mono || palette[2] || stemColor;
      let leaves = "";
      for (let i = 0; i < density; i++) {
        const y = 40 + i * spacing, side = i % 2 ? 1 : -1, r = leafR - i * 0.8;
        if (leafShape === "oval") {
          leaves += `<ellipse cx="${66 + side * offset}" cy="${y}" rx="${r * 0.65}" ry="${r}" fill="${i % 2 ? l1 : l2}"/>`;
        } else {
          leaves += `<circle cx="${66 + side * offset}" cy="${y}" r="${r}" fill="${i % 2 ? l1 : l2}"/>`;
        }
        leaves += `<line x1="66" y1="${y + 14}" x2="${66 + side * 30}" y2="${y + 4}" stroke="${stem}" stroke-width="2.5"/>`;
      }
      return svgWrap(132, 440, stemPath(66, 20, 436, droop, stem, stemThickness) + leaves);
    },
  };
}

/** frond – arching rachis with paired lateral pinnae.
 *  proportions: { maxLen, widthTaper } */
function frond({
  palette = ["#4E6B3C"],
  stemColor = "#4E6B3C",
  stemThickness = 4.5,
  density = 22,
  proportions: { maxLen = 66, widthTaper = 2.4 } = {},
} = {}) {
  return {
    svg(_variant, mono) {
      const c = mono || palette[0];
      let pinnae = "";
      for (let i = 0; i < density; i++) {
        const t = i / density, y = 20 + t * 400;
        const len = Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08)) * maxLen + 6;
        const sw = 5 - t * widthTaper;
        pinnae += `<path d="M 68 ${y} q -${len * 0.6} -8 -${len} 4" stroke="${c}" stroke-width="${sw}" fill="none" stroke-linecap="round"/>`;
        pinnae += `<path d="M 68 ${y + 9} q ${len * 0.6} -8 ${len} 4" stroke="${c}" stroke-width="${sw}" fill="none" stroke-linecap="round"/>`;
      }
      return svgWrap(136, 440,
        `<path d="M 68 436 C 74 300, 62 140, 68 10" stroke="${c}" stroke-width="${stemThickness}" fill="none"/>` +
        pinnae);
    },
  };
}

/** rosette – layered concentric petal whorls.
 *  proportions: { headScale } */
function rosette({
  palette = ["#A8555C", "#8E3F49", "#C27078"],
  stemColor = "#6E7B4E",
  stemThickness = 4,
  proportions: { headScale = 1 } = {},
  droop = 12,
} = {}) {
  return {
    svg(variant, mono) {
      const p1 = mono || palette[0], p2 = mono || (palette[1] || palette[0]), p3 = mono || (palette[2] || palette[0]);
      const stem = mono || stemColor;
      const head = (cx, cy, sc) => `
        <g transform="translate(${cx} ${cy}) scale(${sc * headScale})">
          <path d="M -42 6 Q -50 -30 -14 -44 Q 30 -56 46 -18 Q 54 14 22 34 Q -14 52 -42 6 Z" fill="${p2}"/>
          <path d="M -30 2 Q -34 -26 -4 -34 Q 26 -40 34 -12 Q 38 12 12 24 Q -14 34 -30 2 Z" fill="${p1}"/>
          <path d="M -16 -2 Q -16 -20 2 -22 Q 20 -22 20 -6 Q 20 10 2 14 Q -14 14 -16 -2 Z" fill="${p3}"/>
          <circle cx="1" cy="-4" r="7" fill="${p2}"/>
        </g>`;
      if (variant === "bud") return svgWrap(120, 120, head(60, 60, 1.05));
      return svgWrap(120, 400,
        stemPath(60, 90, 398, droop, stem, stemThickness) +
        `<path d="M 60 96 l -16 26 M 60 96 l 15 24" stroke="${stem}" stroke-width="3" stroke-linecap="round"/>` +
        head(60, 52, 0.92));
    },
  };
}

/** seedPod – compact fuzzy elliptical pod on a slender stem.
 *  fuzz: true = gaussian blur (suppressed in mono/stencil mode)
 *  proportions: { rx, ry, innerRx, innerRy, offsetX, offsetY } */
function seedPod({
  palette = ["#EDE4D2", "#F7F1E4"],
  stemColor = "#C9BC9C",
  stemThickness = 2.5,
  proportions: { rx = 26, ry = 40, innerRx = 18, innerRy = 30, offsetX = -8, offsetY = 8 } = {},
  droop = 10,
  fuzz = true,
} = {}) {
  return {
    svg(variant, mono) {
      const c = mono || palette[0], c2 = mono || (palette[1] || palette[0]);
      const stem = mono || stemColor;
      const blur = `<defs><filter id="f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${fuzz && !mono ? 3 : 0}"/></filter></defs>`;
      const pod = (cx, cy, s) =>
        `<g filter="url(#f)"><ellipse cx="${cx}" cy="${cy}" rx="${rx * s}" ry="${ry * s}" fill="${c}"/><ellipse cx="${cx + offsetX * s}" cy="${cy + offsetY * s}" rx="${innerRx * s}" ry="${innerRy * s}" fill="${c2}"/></g>`;
      if (variant === "bud") return svgWrap(80, 110, blur + pod(40, 55, 1.25));
      return svgWrap(80, 420, blur + stemPath(40, 80, 418, droop, stem, stemThickness) + pod(40, 46, 1));
    },
  };
}

/* ── BUILT-IN FLOWER LIBRARY ──────────────────────────────────── */
/* Each entry spreads a generator's svg method and adds its own    */
/* id, name, real heights (cm), aspect, and representative color.  */

const ASSETS = [
  {
    id: "craspedia", name: "Craspedia (billy ball)", hStem: 60, hBud: 3.5, aspect: 0.22,
    color: "#D9A521",
    ...ball({ palette: ["#D9A521", "#E7B637", "#C4930F"], stemColor: "#7A8B52", stemThickness: 4, density: 60, droop: 16 }),
  },
  {
    id: "lavender", name: "Lavender spike", hStem: 42, hBud: 8, aspect: 0.16,
    color: "#7E6BAE",
    ...spike({ palette: ["#8A76BC", "#6A559E"], stemColor: "#7C8F5E", stemThickness: 3, density: 16, droop: 8 }),
  },
  {
    id: "fern", name: "Fern frond", hStem: 45, hBud: 45, aspect: 0.34,
    color: "#4E6B3C",
    ...frond({ palette: ["#4E6B3C"], stemColor: "#4E6B3C", stemThickness: 4.5, density: 22 }),
  },
  {
    id: "bunny", name: "Bunny tail grass", hStem: 50, hBud: 6, aspect: 0.14,
    color: "#EDE4D2",
    ...seedPod({ palette: ["#EDE4D2", "#F7F1E4"], stemColor: "#C9BC9C", stemThickness: 2.5, droop: 10, fuzz: true }),
  },
  {
    id: "rose", name: "Dried rose", hStem: 35, hBud: 5, aspect: 0.3,
    color: "#A8555C",
    ...rosette({ palette: ["#A8555C", "#8E3F49", "#C27078"], stemColor: "#6E7B4E", stemThickness: 4, droop: 12 }),
  },
  {
    id: "eucalyptus", name: "Eucalyptus stem", hStem: 55, hBud: 55, aspect: 0.3,
    color: "#8FA48B",
    ...leafyBranch({ palette: ["#8FA48B", "#7C927A", "#9A8A6C"], stemColor: "#9A8A6C", stemThickness: 3.5, density: 9, droop: 10, leafShape: "round" }),
  },
  {
    id: "pampas", name: "Pampas plume", hStem: 90, hBud: 30, aspect: 0.3,
    color: "#E4D3B8",
    ...plume({ palette: ["#E4D3B8", "#D3BE9C"], stemColor: "#B9A57F", stemThickness: 3, density: 110, droop: 6 }),
  },
  {
    /* Nigella bleached — custom starburst head; no archetype fits a radial crown.
       Head = 12 pointed outer petals + 8 shorter inner petals + fine bract needles.
       Colors sampled from photo: near-white petals, warm straw shadows, tan stem. */
    id: "nigella", name: "Nigella bleached", hStem: 50, hBud: 7, aspect: 0.27,
    color: "#F0EAD6",
    svg(variant, mono) {
      const petal  = mono || "#F7F3EA";   // near-white petal face
      const shadow = mono || "#E4CFA0";   // warm cream shadow / center
      const bract  = mono || "#D9C28A";   // straw needle bracts
      const stemC  = mono || "#C4A96E";   // tan stem

      const head = (cx, cy, s) => {
        let f = "";
        const pl = 34 * s;  // outer petal length

        // ── Thin straw needle-bracts behind petals (18, deterministic length variation)
        for (let i = 0; i < 18; i++) {
          const a = (i / 18) * Math.PI * 2 + 0.17;
          const len = pl * (1.18 + 0.22 * Math.sin(i * 2.7));
          const mx = cx + Math.cos(a) * len * 0.52;
          const my = cy + Math.sin(a) * len * 0.52;
          const deg = (a * 180 / Math.PI) - 90;
          f += `<ellipse cx="${mx}" cy="${my}" rx="${1.8 * s}" ry="${len * 0.52}" fill="${bract}" transform="rotate(${deg} ${mx} ${my})" opacity="0.72"/>`;
        }

        // ── Outer petals (12, narrow pointed ellipses, slight length variation)
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          const len = pl * (0.84 + 0.16 * Math.sin(i * 1.9 + 0.6));
          const mx = cx + Math.cos(a) * len * 0.5;
          const my = cy + Math.sin(a) * len * 0.5;
          const deg = (a * 180 / Math.PI) - 90;
          const fill = (i % 4 === 0) ? shadow : petal;
          f += `<ellipse cx="${mx}" cy="${my}" rx="${5 * s}" ry="${len * 0.52}" fill="${fill}" transform="rotate(${deg} ${mx} ${my})"/>`;
        }

        // ── Inner petal layer (8, shorter, between outer petals, slightly wider)
        for (let i = 0; i < 8; i++) {
          const a = ((i + 0.5) / 8) * Math.PI * 2;
          const len = pl * 0.54;
          const mx = cx + Math.cos(a) * len * 0.5;
          const my = cy + Math.sin(a) * len * 0.5;
          const deg = (a * 180 / Math.PI) - 90;
          f += `<ellipse cx="${mx}" cy="${my}" rx="${6.5 * s}" ry="${len * 0.52}" fill="${petal}" transform="rotate(${deg} ${mx} ${my})" opacity="0.9"/>`;
        }

        // ── Center knot
        f += `<circle cx="${cx}" cy="${cy}" r="${8 * s}" fill="${shadow}"/>`;
        f += `<circle cx="${cx}" cy="${cy}" r="${4.5 * s}" fill="${petal}"/>`;
        return f;
      };

      if (variant === "bud") return svgWrap(100, 100, head(50, 50, 1));
      return svgWrap(100, 470,
        stemPath(50, 82, 468, 10, stemC, 2.2) +
        head(50, 48, 0.88));
    },
  },
];

const BLEND_MODES = ["normal", "multiply", "screen", "overlay", "soft-light", "hard-light", "difference", "color-burn", "lighten", "darken"];
const CHROME_STOPS = [
  [0, "#BFD8F0"], [0.32, "#F2F8FF"], [0.47, "#FDFDFA"], [0.5, "#54677E"],
  [0.55, "#2E3B4E"], [0.7, "#7A6247"], [0.86, "#D9BC8C"], [1, "#EFE3C8"],
];

const cmToIn = (cm) => cm / 2.54;
const fmt = (cm, unit) => unit === "in" ? `${cmToIn(cm).toFixed(1)}″` : `${cm.toFixed(0)} cm`;

let _id = 1;
const uid = () => `s${_id++}`;

export default function FlowerCanvasStudio() {
  /* canvas + frame */
  const [unit, setUnit] = useState("in");
  const [canvasW, setCanvasW] = useState(45.7); // 18"
  const [canvasH, setCanvasH] = useState(61);   // 24"
  const [barW, setBarW] = useState(3.8);        // 1.5"
  const [barColor, setBarColor] = useState("#7B5B3A");
  const [meshOpacity, setMeshOpacity] = useState(0.16);
  const [zoom, setZoom] = useState(7);

  /* tools */
  const [tool, setTool] = useState("select");
  const [brushSize, setBrushSize] = useState(2.5);
  const [brushOpacity, setBrushOpacity] = useState(0.8);
  const [brushShape, setBrushShape] = useState("soft"); // soft | hard | spray
  const [brushColor, setBrushColor] = useState("#1E3A8A");
  const [paintOnTop, setPaintOnTop] = useState(false);
  const [paintBlend, setPaintBlend] = useState("normal");
  const [paintOpacity, setPaintOpacity] = useState(1);

  /* content */
  const [uploads, setUploads] = useState([]);
  const [stamps, setStamps] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [uploadH, setUploadH] = useState(30);

  const paintRef = useRef(null);
  const meshRef = useRef(null);
  const dragRef = useRef(null);
  const fileRef = useRef(null);

  const allAssets = useMemo(() => [
    ...ASSETS.map(a => ({ ...a, builtin: true })),
    ...uploads,
  ], [uploads]);

  const selected = stamps.find(s => s.id === selectedId) || null;
  const meshWpx = canvasW * zoom, meshHpx = canvasH * zoom;

  /* svg cache so random dots don't reshuffle every render */
  const svgCache = useRef({});
  const assetUrl = (asset, variant, mono) => {
    const key = `${asset.id}|${variant}|${mono || ""}`;
    if (!svgCache.current[key]) {
      if (asset.builtin) {
        svgCache.current[key] = "data:image/svg+xml;utf8," + encodeURIComponent(asset.svg(variant, mono));
      } else {
        svgCache.current[key] = asset.dataUrl;
      }
    }
    return svgCache.current[key];
  };
  const assetH = (asset, variant) => asset.builtin ? (variant === "bud" ? asset.hBud : asset.hStem) : asset.hCm;

  /* ------- paint canvas: keep physical size on resize ------- */
  useEffect(() => {
    const cv = paintRef.current; if (!cv) return;
    const newW = Math.round(canvasW * PAINT_RES), newH = Math.round(canvasH * PAINT_RES);
    if (cv.width === newW && cv.height === newH) return;
    const tmp = document.createElement("canvas");
    tmp.width = cv.width || 1; tmp.height = cv.height || 1;
    tmp.getContext("2d").drawImage(cv, 0, 0);
    cv.width = newW; cv.height = newH;
    cv.getContext("2d").drawImage(tmp, 0, 0);
  }, [canvasW, canvasH]);

  /* ------- painting ------- */
  const paintPos = (e) => {
    const r = paintRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width * paintRef.current.width,
      y: (e.clientY - r.top) / r.height * paintRef.current.height,
    };
  };
  const dab = (ctx, x, y) => {
    const R = (brushSize / 2) * PAINT_RES;
    if (tool === "erase") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.fillStyle = "#000"; ctx.fill();
      return;
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = brushOpacity * (brushShape === "soft" ? 0.55 : 1);
    if (tool === "chrome") {
      const g = ctx.createLinearGradient(0, 0, 0, paintRef.current.height);
      CHROME_STOPS.forEach(([p, c]) => g.addColorStop(p, c));
      ctx.fillStyle = g;
    } else ctx.fillStyle = brushColor;
    if (brushShape === "spray" && tool !== "chrome") {
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * R;
        ctx.globalAlpha = brushOpacity * (0.12 + Math.random() * 0.25);
        ctx.beginPath(); ctx.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr, 0.6 + Math.random() * 1.8, 0, 7); ctx.fill();
      }
    } else if (brushShape === "soft") {
      const g2 = ctx.createRadialGradient(x, y, 0, x, y, R);
      if (tool === "chrome") { ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.fill(); }
      else {
        g2.addColorStop(0, brushColor); g2.addColorStop(1, brushColor + "00");
        ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.fill();
      }
    } else {
      ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.fill();
    }
  };
  const onPaintDown = (e) => {
    if (!["paint", "erase", "chrome"].includes(tool)) return;
    e.target.setPointerCapture(e.pointerId);
    const ctx = paintRef.current.getContext("2d");
    const p = paintPos(e); dab(ctx, p.x, p.y);
    dragRef.current = { painting: true, last: p };
  };
  const onPaintMove = (e) => {
    if (!dragRef.current?.painting) return;
    const ctx = paintRef.current.getContext("2d");
    const p = paintPos(e), last = dragRef.current.last;
    const d = Math.hypot(p.x - last.x, p.y - last.y);
    const step = Math.max(2, (brushSize / 2) * PAINT_RES * (brushShape === "soft" ? 0.35 : 0.5));
    for (let t = step; t <= d; t += step)
      dab(ctx, last.x + (p.x - last.x) * t / d, last.y + (p.y - last.y) * t / d);
    if (d >= step) dragRef.current.last = p;
  };
  const onPaintUp = () => { dragRef.current = null; };

  /* ------- stamps ------- */
  const addStamp = (asset) => {
    const s = {
      id: uid(), assetId: asset.id,
      x: canvasW / 2 + (Math.random() * 6 - 3), y: canvasH / 2 + (Math.random() * 6 - 3),
      scale: 1, rotation: 0, flip: false, opacity: 1, blend: "normal",
      variant: "stem", silhouette: false, silColor: "#111111",
    };
    setStamps(v => [...v, s]); setSelectedId(s.id); setTool("select");
  };
  const patch = (id, up) => setStamps(v => v.map(s => s.id === id ? { ...s, ...up } : s));
  const removeStamp = (id) => { setStamps(v => v.filter(s => s.id !== id)); if (selectedId === id) setSelectedId(null); };

  const onStampDown = (e, s) => {
    if (tool !== "select") return;
    e.stopPropagation();
    setSelectedId(s.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { stamp: s.id, sx: e.clientX, sy: e.clientY, ox: s.x, oy: s.y };
  };
  const onStampMove = (e) => {
    const d = dragRef.current;
    if (!d?.stamp) return;
    patch(d.stamp, { x: d.ox + (e.clientX - d.sx) / zoom, y: d.oy + (e.clientY - d.sy) / zoom });
  };

  useEffect(() => {
    const onKey = (e) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId &&
          !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) removeStamp(selectedId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* punch selected stamp out of the paint layer (negative stencil) */
  const punchOut = async (s) => {
    const asset = allAssets.find(a => a.id === s.assetId); if (!asset) return;
    const img = new Image();
    img.src = assetUrl(asset, s.variant, asset.builtin ? "#000" : null);
    await img.decode();
    const cv = paintRef.current, ctx = cv.getContext("2d");
    const hPx = assetH(asset, s.variant) * s.scale * PAINT_RES;
    const wPx = hPx * (img.width / img.height);
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = 1;
    ctx.translate(s.x * PAINT_RES, s.y * PAINT_RES);
    ctx.rotate(s.rotation * Math.PI / 180);
    ctx.scale(s.flip ? -1 : 1, 1);
    ctx.drawImage(img, -wPx / 2, -hPx / 2, wPx, hPx);
    ctx.restore();
  };

  /* ------- uploads ------- */
  const onFile = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      setUploads(v => [...v, {
        id: `u${Date.now()}`, name: f.name.replace(/\.[^.]+$/, ""),
        dataUrl: rd.result, hCm: uploadH, builtin: false,
      }]);
    };
    rd.readAsDataURL(f);
    e.target.value = "";
  };

  /* ------- export ------- */
  const exportPNG = async () => {
    const R = EXPORT_RES;
    const bw = barW * R, W = canvasW * R, H = canvasH * R;
    const out = document.createElement("canvas");
    out.width = W + bw * 2; out.height = H + bw * 2;
    const ctx = out.getContext("2d");
    ctx.fillStyle = barColor; ctx.fillRect(0, 0, out.width, out.height);
    ctx.save(); ctx.translate(bw, bw);
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    ctx.fillStyle = `rgba(250,249,245,${meshOpacity})`; ctx.fillRect(0, 0, W, H);

    const drawPaint = () => {
      ctx.save();
      ctx.globalAlpha = paintOpacity;
      ctx.globalCompositeOperation = paintBlend === "normal" ? "source-over" : paintBlend;
      ctx.drawImage(paintRef.current, 0, 0, W, H);
      ctx.restore();
    };
    if (!paintOnTop) drawPaint();

    for (const s of stamps) {
      const asset = allAssets.find(a => a.id === s.assetId); if (!asset) continue;
      const img = new Image();
      img.src = assetUrl(asset, s.variant, s.silhouette && asset.builtin ? s.silColor : null);
      try { await img.decode(); } catch { continue; }
      const hPx = assetH(asset, s.variant) * s.scale * R;
      const wPx = hPx * (img.width / img.height);
      let src = img;
      if (s.silhouette && !asset.builtin) {
        const t = document.createElement("canvas");
        t.width = img.width; t.height = img.height;
        const tc = t.getContext("2d");
        tc.drawImage(img, 0, 0);
        tc.globalCompositeOperation = "source-in";
        tc.fillStyle = s.silColor; tc.fillRect(0, 0, t.width, t.height);
        src = t;
      }
      ctx.save();
      ctx.globalAlpha = s.opacity;
      ctx.globalCompositeOperation = s.blend === "normal" ? "source-over" : s.blend;
      ctx.translate(s.x * R, s.y * R);
      ctx.rotate(s.rotation * Math.PI / 180);
      ctx.scale(s.flip ? -1 : 1, 1);
      ctx.drawImage(src, -wPx / 2, -hPx / 2, wPx, hPx);
      ctx.restore();
    }
    if (paintOnTop) drawPaint();
    ctx.restore();

    const a = document.createElement("a");
    a.href = out.toDataURL("image/png");
    a.download = `canvas-${fmt(canvasW, unit)}x${fmt(canvasH, unit)}.png`.replace(/″/g, "in");
    a.click();
  };

  /* ------- UI helpers ------- */
  const dim = (cm) => unit === "in" ? cmToIn(cm) : cm;
  const toCm = (v) => unit === "in" ? v * 2.54 : v;

  const S = styles;
  const paintZ = paintOnTop ? 500 : 0;

  return (
    <div style={S.app}>
      {/* ---------- header ---------- */}
      <header style={S.header}>
        <div>
          <div style={S.title}>Flower Canvas Studio</div>
          <div style={S.sub}>dried botanicals · UV resin on sheer mesh</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={S.mini}>Zoom
            <input type="range" min="3" max="16" step="0.5" value={zoom} onChange={e => setZoom(+e.target.value)} />
          </label>
          <button style={S.primaryBtn} onClick={exportPNG}>Export PNG</button>
        </div>
      </header>

      <div style={S.body}>
        {/* ---------- left: tools + library ---------- */}
        <aside style={S.left}>
          <div style={S.toolRow}>
            {[["select", "Select"], ["paint", "Paint"], ["chrome", "Chrome"], ["erase", "Erase"]].map(([t, label]) => (
              <button key={t} onClick={() => setTool(t)}
                style={{ ...S.toolBtn, ...(tool === t ? S.toolBtnOn : {}) }}>{label}</button>
            ))}
          </div>

          <div style={S.sectionLabel}>Flower library</div>
          <div style={S.library}>
            {allAssets.map(a => (
              <button key={a.id} style={S.libItem} onClick={() => addStamp(a)} title={`Add ${a.name}`}>
                <img alt={a.name} src={assetUrl(a, "stem", null)}
                  style={{ maxHeight: 54, maxWidth: 40, objectFit: "contain" }} />
                <div style={S.libName}>{a.name}</div>
                <div style={S.libDim}>{fmt(assetH(a, "stem"), unit)}</div>
              </button>
            ))}
          </div>

          <div style={S.sectionLabel}>Add your own (PNG, transparent)</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <label style={S.mini}>Real height
              <input style={S.numInput} type="number" min="1" value={uploadH}
                onChange={e => setUploadH(+e.target.value || 1)} /> cm
            </label>
            <button style={S.btn} onClick={() => fileRef.current.click()}>Upload</button>
            <input ref={fileRef} type="file" accept="image/png,image/webp" hidden onChange={onFile} />
          </div>
          <p style={S.hint}>Cut-out photos of your real flowers drop in at true scale. Photograph them next to a ruler, remove the background, upload here.</p>
        </aside>

        {/* ---------- center: the drum ---------- */}
        <main style={S.stage} onPointerDown={() => tool === "select" && setSelectedId(null)}>
          <div style={{ ...S.frame, padding: barW * zoom, background: barColor }}>
            <div style={S.frameGrain} />
            <div ref={meshRef} style={{ ...S.mesh, width: meshWpx, height: meshHpx }}>
              <div style={{ ...S.meshWeave, opacity: meshOpacity * 2.2 }} />
              <div style={S.meshSheen} />
              <canvas
                ref={paintRef}
                style={{ ...S.paint, zIndex: paintZ, opacity: paintOpacity,
                  mixBlendMode: paintBlend,
                  pointerEvents: tool === "select" ? "none" : "auto",
                  cursor: "crosshair" }}
                onPointerDown={onPaintDown} onPointerMove={onPaintMove}
                onPointerUp={onPaintUp} onPointerCancel={onPaintUp}
              />
              {stamps.map((s, i) => {
                const asset = allAssets.find(a => a.id === s.assetId); if (!asset) return null;
                const hPx = assetH(asset, s.variant) * s.scale * zoom;
                const sil = s.silhouette;
                const url = assetUrl(asset, s.variant, sil && asset.builtin ? s.silColor : null);
                const uploadFilter = sil && !asset.builtin
                  ? (s.silColor === "#FFFFFF" ? "brightness(0) invert(1)" : "brightness(0)") : "none";
                return (
                  <img key={s.id} src={url} alt={asset.name} draggable={false}
                    onPointerDown={e => onStampDown(e, s)} onPointerMove={onStampMove}
                    onPointerUp={() => (dragRef.current = null)}
                    style={{
                      position: "absolute", left: s.x * zoom, top: s.y * zoom,
                      height: hPx, zIndex: i + 1,
                      transform: `translate(-50%,-50%) rotate(${s.rotation}deg) scaleX(${s.flip ? -1 : 1})`,
                      opacity: s.opacity, mixBlendMode: s.blend,
                      filter: uploadFilter,
                      outline: s.id === selectedId ? "2px dashed #4A5D3A" : "none",
                      outlineOffset: 3,
                      cursor: tool === "select" ? "grab" : "default",
                      pointerEvents: tool === "select" ? "auto" : "none",
                      touchAction: "none", userSelect: "none",
                    }} />
                );
              })}
            </div>
          </div>
          <div style={S.dims}>{fmt(canvasW, unit)} × {fmt(canvasH, unit)} · bars {fmt(barW, unit)}</div>
        </main>

        {/* ---------- right: properties ---------- */}
        <aside style={S.right}>
          <div style={S.sectionLabel}>Canvas & stretcher bars</div>
          <div style={S.row}>
            <label style={S.mini}>W <input style={S.numInput} type="number" step="0.5"
              value={+dim(canvasW).toFixed(1)} onChange={e => setCanvasW(Math.max(5, toCm(+e.target.value)))} /></label>
            <label style={S.mini}>H <input style={S.numInput} type="number" step="0.5"
              value={+dim(canvasH).toFixed(1)} onChange={e => setCanvasH(Math.max(5, toCm(+e.target.value)))} /></label>
            <select style={S.select} value={unit} onChange={e => setUnit(e.target.value)}>
              <option value="in">inches</option><option value="cm">cm</option>
            </select>
          </div>
          <label style={S.slider}>Bar width — {fmt(barW, unit)}
            <input type="range" min="1" max="10" step="0.1" value={barW} onChange={e => setBarW(+e.target.value)} />
          </label>
          <label style={S.mini}>Bar color <input type="color" value={barColor} onChange={e => setBarColor(e.target.value)} /></label>
          <label style={S.slider}>Mesh visibility — {(meshOpacity * 100) | 0}%
            <input type="range" min="0" max="0.5" step="0.01" value={meshOpacity} onChange={e => setMeshOpacity(+e.target.value)} />
          </label>

          {["paint", "erase", "chrome"].includes(tool) && (<>
            <div style={S.sectionLabel}>{tool === "chrome" ? "Chrome mirror brush" : tool === "erase" ? "Eraser" : "Paint brush"}</div>
            <label style={S.slider}>Size — {fmt(brushSize, unit)}
              <input type="range" min="0.2" max="12" step="0.1" value={brushSize} onChange={e => setBrushSize(+e.target.value)} />
            </label>
            {tool !== "erase" && <>
              <label style={S.slider}>Opacity — {(brushOpacity * 100) | 0}%
                <input type="range" min="0.05" max="1" step="0.05" value={brushOpacity} onChange={e => setBrushOpacity(+e.target.value)} />
              </label>
              <div style={S.row}>
                {["soft", "hard", "spray"].map(sh => (
                  <button key={sh} onClick={() => setBrushShape(sh)}
                    style={{ ...S.toolBtn, ...(brushShape === sh ? S.toolBtnOn : {}) }}>{sh}</button>
                ))}
              </div>
              {tool === "paint" && <label style={S.mini}>Color <input type="color" value={brushColor} onChange={e => setBrushColor(e.target.value)} /></label>}
            </>}
            <div style={S.sectionLabel}>Paint layer</div>
            <label style={S.mini}><input type="checkbox" checked={paintOnTop} onChange={e => setPaintOnTop(e.target.checked)} /> paint sits over flowers</label>
            <label style={S.mini}>Blend <select style={S.select} value={paintBlend} onChange={e => setPaintBlend(e.target.value)}>
              {BLEND_MODES.map(m => <option key={m}>{m}</option>)}</select></label>
            <label style={S.slider}>Layer opacity — {(paintOpacity * 100) | 0}%
              <input type="range" min="0" max="1" step="0.05" value={paintOpacity} onChange={e => setPaintOpacity(+e.target.value)} />
            </label>
            <button style={S.btn} onClick={() => {
              const c = paintRef.current; c.getContext("2d").clearRect(0, 0, c.width, c.height);
              setStamps(v => [...v]); // force refresh
            }}>Clear paint layer</button>
          </>)}

          {selected && (() => {
            const asset = allAssets.find(a => a.id === selected.assetId);
            const realH = assetH(asset, selected.variant) * selected.scale;
            return (<>
              <div style={S.sectionLabel}>{asset?.name}</div>
              <div style={S.libDim}>current real height: <b>{fmt(realH, unit)}</b></div>
              {asset?.builtin && asset.hStem !== asset.hBud && (
                <div style={S.row}>
                  {["stem", "bud"].map(v => (
                    <button key={v} onClick={() => patch(selected.id, { variant: v })}
                      style={{ ...S.toolBtn, ...(selected.variant === v ? S.toolBtnOn : {}) }}>
                      {v === "stem" ? "full stem" : "bud only"}</button>
                  ))}
                </div>
              )}
              <label style={S.slider}>Scale — {(selected.scale * 100) | 0}%
                <input type="range" min="0.15" max="3" step="0.01" value={selected.scale}
                  onChange={e => patch(selected.id, { scale: +e.target.value })} />
              </label>
              <label style={S.slider}>Rotation — {selected.rotation | 0}°
                <input type="range" min="-180" max="180" step="1" value={selected.rotation}
                  onChange={e => patch(selected.id, { rotation: +e.target.value })} />
              </label>
              <label style={S.slider}>Opacity — {(selected.opacity * 100) | 0}%
                <input type="range" min="0.05" max="1" step="0.05" value={selected.opacity}
                  onChange={e => patch(selected.id, { opacity: +e.target.value })} />
              </label>
              <label style={S.mini}>Blend <select style={S.select} value={selected.blend}
                onChange={e => patch(selected.id, { blend: e.target.value })}>
                {BLEND_MODES.map(m => <option key={m}>{m}</option>)}</select></label>
              <div style={S.row}>
                <label style={S.mini}><input type="checkbox" checked={selected.silhouette}
                  onChange={e => patch(selected.id, { silhouette: e.target.checked })} /> stencil silhouette</label>
                {selected.silhouette && (
                  <select style={S.select} value={selected.silColor}
                    onChange={e => patch(selected.id, { silColor: e.target.value })}>
                    <option value="#111111">black</option><option value="#FFFFFF">white</option>
                  </select>
                )}
              </div>
              <div style={S.row}>
                <button style={S.btn} onClick={() => patch(selected.id, { flip: !selected.flip })}>Flip</button>
                <button style={S.btn} onClick={() => {
                  const c = { ...selected, id: uid(), x: selected.x + 3, y: selected.y + 3 };
                  setStamps(v => [...v, c]); setSelectedId(c.id);
                }}>Duplicate</button>
              </div>
              <div style={S.row}>
                <button style={S.btn} onClick={() => setStamps(v => {
                  const i = v.findIndex(s => s.id === selected.id);
                  if (i < 1) return v;
                  const n = [...v]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n;
                })}>Send back</button>
                <button style={S.btn} onClick={() => setStamps(v => {
                  const i = v.findIndex(s => s.id === selected.id);
                  if (i < 0 || i === v.length - 1) return v;
                  const n = [...v]; [n[i], n[i + 1]] = [n[i + 1], n[i]]; return n;
                })}>Bring forward</button>
              </div>
              <button style={S.btn} onClick={() => punchOut(selected)}
                title="Erases this flower's shape from the paint layer — like lifting a stencil after spraying">
                Punch out of paint (stencil lift)</button>
              <button style={{ ...S.btn, color: "#8E3F49" }} onClick={() => removeStamp(selected.id)}>Delete</button>
            </>);
          })()}

          {!selected && tool === "select" && (
            <p style={S.hint}>Click a flower in the library to place it, then drag it on the canvas. Its printed size stays true to the real dried flower.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

/* ---------- styles ---------- */
const panelBg = "#F3F2EC";
const ink = "#23281F";
const styles = {
  app: { display: "flex", flexDirection: "column", height: "100vh", fontFamily: "'Avenir Next','Segoe UI',system-ui,sans-serif", color: ink, background: "#DAD5C9" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", background: panelBg, borderBottom: "1px solid #C9C4B6" },
  title: { fontFamily: "Georgia,'Times New Roman',serif", fontSize: 19, letterSpacing: 0.3 },
  sub: { fontSize: 11, color: "#6B7060", letterSpacing: 0.6, textTransform: "uppercase" },
  body: { display: "flex", flex: 1, minHeight: 0 },
  left: { width: 230, background: panelBg, borderRight: "1px solid #C9C4B6", padding: 12, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 },
  right: { width: 250, background: panelBg, borderLeft: "1px solid #C9C4B6", padding: 12, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 },
  stage: { flex: 1, overflow: "auto", display: "grid", placeItems: "center", padding: 40, background: "radial-gradient(120% 100% at 50% 0%, #E4DFD3 0%, #CEC8BA 100%)" },
  frame: { position: "relative", boxShadow: "0 18px 40px rgba(40,35,25,.35), 0 2px 6px rgba(40,35,25,.25)", borderRadius: 2 },
  frameGrain: { position: "absolute", inset: 0, borderRadius: 2, pointerEvents: "none", background: "repeating-linear-gradient(92deg, rgba(255,255,255,.06) 0 2px, rgba(0,0,0,.07) 2px 5px)", mixBlendMode: "overlay" },
  mesh: { position: "relative", overflow: "hidden", background: "transparent", boxShadow: "inset 0 0 22px rgba(30,25,15,.28)" },
  meshWeave: { position: "absolute", inset: 0, pointerEvents: "none", zIndex: 400, background: "repeating-linear-gradient(0deg, rgba(252,250,244,.9) 0 .5px, transparent .5px 3px), repeating-linear-gradient(90deg, rgba(252,250,244,.9) 0 .5px, transparent .5px 3px)" },
  meshSheen: { position: "absolute", inset: 0, pointerEvents: "none", zIndex: 401, background: "linear-gradient(112deg, rgba(255,255,255,.14) 0%, rgba(255,255,255,0) 34%, rgba(255,255,255,.05) 70%, rgba(255,255,255,0) 100%)" },
  paint: { position: "absolute", inset: 0, width: "100%", height: "100%" },
  dims: { marginTop: 14, fontSize: 12, color: "#5D6152", letterSpacing: 0.4 },
  toolRow: { display: "flex", gap: 4, flexWrap: "wrap" },
  toolBtn: { flex: 1, padding: "6px 4px", fontSize: 12, border: "1px solid #C9C4B6", background: "#FBFAF6", borderRadius: 6, cursor: "pointer", color: ink },
  toolBtnOn: { background: "#4A5D3A", color: "#F6F5EE", borderColor: "#4A5D3A" },
  sectionLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#6B7060", borderBottom: "1px solid #D8D3C6", paddingBottom: 4, marginTop: 4 },
  library: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 },
  libItem: { display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: 6, background: "#FBFAF6", border: "1px solid #D8D3C6", borderRadius: 8, cursor: "pointer" },
  libName: { fontSize: 10.5, textAlign: "center", lineHeight: 1.2, color: ink },
  libDim: { fontSize: 10, color: "#8A8D7C" },
  row: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" },
  mini: { fontSize: 12, display: "flex", alignItems: "center", gap: 5 },
  slider: { fontSize: 12, display: "flex", flexDirection: "column", gap: 2 },
  numInput: { width: 54, padding: "3px 5px", border: "1px solid #C9C4B6", borderRadius: 5, background: "#FBFAF6", fontSize: 12 },
  select: { padding: "3px 5px", border: "1px solid #C9C4B6", borderRadius: 5, background: "#FBFAF6", fontSize: 12 },
  btn: { padding: "6px 8px", fontSize: 12, border: "1px solid #C9C4B6", background: "#FBFAF6", borderRadius: 6, cursor: "pointer", color: ink, textAlign: "left" },
  primaryBtn: { padding: "7px 14px", fontSize: 13, border: "none", background: "#4A5D3A", color: "#F6F5EE", borderRadius: 7, cursor: "pointer" },
  hint: { fontSize: 11.5, color: "#75786A", lineHeight: 1.45, margin: 0 },
};
