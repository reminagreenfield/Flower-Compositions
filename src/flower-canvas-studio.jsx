import { useState, useRef, useEffect, useMemo } from "react";

/* ============================================================
   FLOWER CANVAS STUDIO
   Design mockup tool for dried-flower + UV resin works on
   sheer mesh stretched over bars. All sizes are real-world cm.
   ============================================================ */

const PAINT_RES = 8;    // paint raster resolution, px per cm
const EXPORT_RES = 12;  // export resolution, px per cm
const BEND_REACH = 0.18; // furthest sideways lean of a stem tip, as a fraction of the flower's height

/* The plaster wall behind the piece. This is what you see THROUGH the mesh,
   so the stage and the PNG export both read from here to stay in step. */
const WALL = { light: "#E4DFD3", dark: "#CEC8BA", flat: "#D9D3C6" };

/* ── SVG PRIMITIVES ───────────────────────────────────────────── */
function svgWrap(w, h, inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${inner}</svg>`;
}

/* How far a stem tip leans sideways, in SVG units, for a given bend. */
const bendDx = (bend, h) => (bend || 0) * BEND_REACH * h;

/* The viewBox grows by `pad` on BOTH sides so a leaning flower never
   clips and its centre — and therefore its real height — stays put.
   pad 0 renders exactly as an unbent stem always did.                 */
const padWrap = (w, h, pad, inner) =>
  svgWrap(w + pad * 2, h, `<g transform="translate(${pad} 0)">${inner}</g>`);

const stemPath = (x, topY, botY, sway, color, sw, tipDx = 0) =>
  `<path d="M ${x} ${botY} C ${x + sway} ${botY - (botY - topY) * 0.4}, ${x - sway + tipDx * 0.35} ${topY + (botY - topY) * 0.3}, ${x + tipDx} ${topY}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`;

/* ── STEM GEOMETRY ────────────────────────────────────────────── */
/* A stem is one cubic bezier. Sampling it gives every height along the
   stem a real position AND a real direction, so heads and leaves can
   sit on the curve and lean with it instead of sliding sideways while
   staying bolt upright. Same control points as stemPath above.        */
function stemFrame(x, topY, botY, sway, tipDx = 0) {
  const P = [
    [x, botY],
    [x + sway, botY - (botY - topY) * 0.4],
    [x - sway + tipDx * 0.35, topY + (botY - topY) * 0.3],
    [x + tipDx, topY],
  ];
  const N = 48, pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t;
    const px = u*u*u*P[0][0] + 3*u*u*t*P[1][0] + 3*u*t*t*P[2][0] + t*t*t*P[3][0];
    const py = u*u*u*P[0][1] + 3*u*u*t*P[1][1] + 3*u*t*t*P[2][1] + t*t*t*P[3][1];
    const dx = 3*u*u*(P[1][0]-P[0][0]) + 6*u*t*(P[2][0]-P[1][0]) + 3*t*t*(P[3][0]-P[2][0]);
    const dy = 3*u*u*(P[1][1]-P[0][1]) + 6*u*t*(P[2][1]-P[1][1]) + 3*t*t*(P[3][1]-P[2][1]);
    pts.push({ x: px, y: py, a: Math.atan2(dx, -dy) * 180 / Math.PI }); // 0° = straight up, + = leans right
  }
  const tip = pts[N];
  const at = (y) => {
    for (let i = 0; i < N; i++) {
      const A = pts[i], B = pts[i + 1];
      if ((y <= A.y && y >= B.y) || (y >= A.y && y <= B.y)) {
        const f = Math.abs(B.y - A.y) < 1e-6 ? 0 : (y - A.y) / (B.y - A.y);
        return { x: A.x + (B.x - A.x) * f, angle: A.a + (B.a - A.a) * f };
      }
    }
    const E = y > pts[0].y ? pts[0] : tip;   // above the tip: carry the tip's frame
    return { x: E.x, angle: E.a };
  };
  return {
    at,
    tipAngle: tip.a,
    /* A long head (spike, plume) hinges where it meets the stem, so it
       pivots on the tip and swings as one piece. */
    head: (inner) =>
      `<g transform="rotate(${tip.a} ${tip.x} ${topY}) translate(${tipDx} 0)">${inner}</g>`,

    /* A compact head (ball, rosette, pod, crown) instead rides out along
       the stem's direction and turns about its OWN centre. Pivoting such
       a head on the tip would swing its far edge upward and out of the
       viewBox; carrying the centre keeps it inside and looks the same. */
    crown: (inner, cx, cy) => {
      const r = tip.a * Math.PI / 180, dist = topY - cy;
      const nx = tip.x + dist * Math.sin(r), ny = topY - dist * Math.cos(r);
      return `<g transform="rotate(${tip.a} ${nx} ${ny}) translate(${nx - cx} ${ny - cy})">${inner}</g>`;
    },
    /* A leaf or pinna drawn at height y off the axis x0: dropped onto the
       curve at that height and turned to match the stem's lean there. */
    along: (y, x0, inner) => {
      const f = at(y);
      // transform list applies right-to-left: spin about the attach point
      // as drawn, THEN slide that point onto the curve.
      return `<g transform="translate(${f.x - x0} 0) rotate(${f.angle} ${x0} ${y})">${inner}</g>`;
    },
    /* Margin the drawing needs once things swing out. `reach` is how far
       the swinging part extends from its pivot. Over-padding only adds
       transparent margin, so this errs generous. */
    pad: (reach) => Math.abs(tipDx) + reach * Math.abs(Math.sin(tip.a * Math.PI / 180)),
  };
}

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
  const S = 0.95;                                        // head scale, shared by both variants
  // florets are rotated ±30°, so their reach is the ellipse's diagonal, not its ry
  const reach = Math.hypot(floretW, floretH) * S;
  const budH = (density - 1) * spacing * S + 4 + 2 * reach;
  return {
    budRatio: budH / 400,
    svg(variant, mono, bend) {
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
      if (variant === "bud") return svgWrap(64, budH, body(32, reach, S));
      const dx = bendDx(bend, 400);
      const fr = stemFrame(32, 150, 398, droop, dx);
      return padWrap(64, 400, fr.pad(140 + reach),
        stemPath(32, 150, 398, droop, stem, stemThickness, dx) + fr.head(body(32, 10, S)));
    },
  };
}

/** ball – spherical head with scattered dot florets on a stem.
 *  proportions: { headR, dotRMin, dotRMax } */
function ball({
  palette = ["#D9A521", "#E7B637", "#C4930F"],
  stemColor = "#7A8B52",
  stemThickness = 4,
  density = 60,
  proportions: { headR = 28, dotRMin = 1.4, dotRMax = 2.4 } = {},
  droop = 16,
} = {}) {
  return {
    budRatio: (headR * 2) / 455,
    svg(variant, mono, bend) {
      const base = mono || palette[0];
      const stem = mono || stemColor;
      const head = (cx, cy) => {
        let dots = "";
        for (let i = 0; i < density; i++) {
          const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (headR - 2);
          dots += `<circle cx="${cx + Math.cos(a) * r}" cy="${cy + Math.sin(a) * r}" r="${dotRMin + Math.random() * (dotRMax - dotRMin)}" fill="${mono || palette[1]}"/>`;
        }
        return `<circle cx="${cx}" cy="${cy}" r="${headR}" fill="${base}"/>` + dots;
      };
      if (variant === "bud") return svgWrap(headR * 2, headR * 2, head(headR, headR));
      const dx = bendDx(bend, 455);
      const fr = stemFrame(50, 56, 452, droop, dx);
      return padWrap(100, 455, fr.pad(26 + headR),
        stemPath(50, 56, 452, droop, stem, stemThickness, dx) + fr.crown(head(50, 30), 50, 30));
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
  const FIELD = 210;              // length of the strand field on the stem variant
  const budH = FIELD + 32;        // strands overshoot 8 above and 24 below the field
  return {
    budRatio: budH / 440,
    svg(variant, mono, bend) {
      const c1 = mono || palette[0], c2 = mono || (palette[1] || palette[0]);
      const stem = mono || stemColor;
      const plumeBody = (ox, oy, h) => {
        let s = "";
        for (let i = 0; i < density; i++) {
          const t = Math.random(), y = oy + t * h;
          const sp = Math.sin(Math.PI * Math.min(1, t + .05)) * spread + 6;
          const x = ox + (Math.random() * 2 - 1) * sp;
          s += `<path d="M ${ox} ${y + 24} Q ${x} ${y + 10} ${x + (Math.random() * 14 - 7)} ${y - 8}" stroke="${Math.random() > .5 ? c1 : c2}" stroke-width="${1 + Math.random() * 1.6}" fill="none" opacity="${mono ? 1 : 0.6 + Math.random() * 0.4}" stroke-linecap="round"/>`;
        }
        return s;
      };
      if (variant === "bud") return svgWrap(132, budH, plumeBody(66, 8, FIELD));
      const dx = bendDx(bend, 440);
      const fr = stemFrame(66, 200, 438, droop, dx);
      return padWrap(132, 440, fr.pad(196),
        stemPath(66, 200, 438, droop, stem, stemThickness, dx) + fr.head(plumeBody(66, 12, FIELD)));
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
    budRatio: 1,               // no separate head — the whole sprig is the flower
    svg(_variant, mono, bend) {
      const l1 = mono || palette[0], l2 = mono || (palette[1] || palette[0]);
      const stem = mono || palette[2] || stemColor;
      const dx = bendDx(bend, 440);
      const fr = stemFrame(66, 20, 436, droop, dx);
      let leaves = "";
      for (let i = 0; i < density; i++) {
        const y = 40 + i * spacing, side = i % 2 ? 1 : -1, r = leafR - i * 0.8;
        const blade = leafShape === "oval"
          ? `<ellipse cx="${66 + side * offset}" cy="${y}" rx="${r * 0.65}" ry="${r}" fill="${i % 2 ? l1 : l2}"/>`
          : `<circle cx="${66 + side * offset}" cy="${y}" r="${r}" fill="${i % 2 ? l1 : l2}"/>`;
        const petiole = `<line x1="66" y1="${y + 14}" x2="${66 + side * 30}" y2="${y + 4}" stroke="${stem}" stroke-width="2.5"/>`;
        leaves += fr.along(y, 66, blade + petiole);   // sits on the curve, turns with it
      }
      return padWrap(132, 440, fr.pad(offset + leafR),
        stemPath(66, 20, 436, droop, stem, stemThickness, dx) + leaves);
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
    budRatio: 1,               // no separate head — the whole frond is the flower
    svg(_variant, mono, bend) {
      const c = mono || palette[0];
      const dx = bendDx(bend, 440);
      const fr = stemFrame(68, 10, 436, 6, dx);
      let pinnae = "";
      for (let i = 0; i < density; i++) {
        const t = i / density, y = 20 + t * 400;
        const len = Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08)) * maxLen + 6;
        const sw = 5 - t * widthTaper;
        const pair =
          `<path d="M 68 ${y} q -${len * 0.6} -8 -${len} 4" stroke="${c}" stroke-width="${sw}" fill="none" stroke-linecap="round"/>` +
          `<path d="M 68 ${y + 9} q ${len * 0.6} -8 ${len} 4" stroke="${c}" stroke-width="${sw}" fill="none" stroke-linecap="round"/>`;
        pinnae += fr.along(y, 68, pair);              // sits on the rachis, turns with it
      }
      return padWrap(136, 440, fr.pad(maxLen + 6),
        stemPath(68, 10, 436, 6, c, stemThickness, dx) + pinnae);
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
  const HEAD_BOX = 100;                        // nominal head bbox in local units
  const S = 0.92;                              // head scale, shared by both variants
  const budV = HEAD_BOX * S * headScale;
  return {
    budRatio: budV / 400,
    svg(variant, mono, bend) {
      const p1 = mono || palette[0], p2 = mono || (palette[1] || palette[0]), p3 = mono || (palette[2] || palette[0]);
      const stem = mono || stemColor;
      const head = (cx, cy, sc) => `
        <g transform="translate(${cx} ${cy}) scale(${sc * headScale})">
          <path d="M -42 6 Q -50 -30 -14 -44 Q 30 -56 46 -18 Q 54 14 22 34 Q -14 52 -42 6 Z" fill="${p2}"/>
          <path d="M -30 2 Q -34 -26 -4 -34 Q 26 -40 34 -12 Q 38 12 12 24 Q -14 34 -30 2 Z" fill="${p1}"/>
          <path d="M -16 -2 Q -16 -20 2 -22 Q 20 -22 20 -6 Q 20 10 2 14 Q -14 14 -16 -2 Z" fill="${p3}"/>
          <circle cx="1" cy="-4" r="7" fill="${p2}"/>
        </g>`;
      if (variant === "bud") return svgWrap(budV, budV, head(budV / 2, budV / 2, S));
      const dx = bendDx(bend, 400);
      const fr = stemFrame(60, 90, 398, droop, dx);
      return padWrap(120, 400, fr.pad(38 + 45 * headScale),
        stemPath(60, 90, 398, droop, stem, stemThickness, dx) +
        fr.crown(
          `<path d="M 60 96 l -16 26 M 60 96 l 15 24" stroke="${stem}" stroke-width="3" stroke-linecap="round"/>` +
          head(60, 52, S), 60, 52));
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
  const PAD = fuzz ? 8 : 2;                     // room for the blur to fall off
  const budW = rx * 2 + PAD * 2, budH = ry * 2 + PAD * 2;
  return {
    budRatio: budH / 420,
    svg(variant, mono, bend) {
      const c = mono || palette[0], c2 = mono || (palette[1] || palette[0]);
      const stem = mono || stemColor;
      const blur = `<defs><filter id="f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${fuzz && !mono ? 3 : 0}"/></filter></defs>`;
      const pod = (cx, cy, s) =>
        `<g filter="url(#f)"><ellipse cx="${cx}" cy="${cy}" rx="${rx * s}" ry="${ry * s}" fill="${c}"/><ellipse cx="${cx + offsetX * s}" cy="${cy + offsetY * s}" rx="${innerRx * s}" ry="${innerRy * s}" fill="${c2}"/></g>`;
      if (variant === "bud") return svgWrap(budW, budH, blur + pod(budW / 2, budH / 2, 1));
      const dx = bendDx(bend, 420);
      const fr = stemFrame(40, 80, 418, droop, dx);
      return padWrap(80, 420, fr.pad(34 + ry),
        blur + stemPath(40, 80, 418, droop, stem, stemThickness, dx) + fr.crown(pod(40, 46, 1), 40, 46));
    },
  };
}

/* ── BUILT-IN FLOWER LIBRARY ──────────────────────────────────── */
/* Each entry spreads a generator's svg method and adds its own    */
/* id, name, real heights (cm), aspect, and representative color.  */

const RAW_ASSETS = [
  {
    id: "craspedia", name: "Craspedia (billy ball)", hStem: 60, aspect: 0.22,
    color: "#D9A521",
    ...ball({ palette: ["#D9A521", "#E7B637", "#C4930F"], stemColor: "#7A8B52", stemThickness: 4, density: 60, droop: 16 }),
  },
  {
    id: "lavender", name: "Lavender spike", hStem: 42, aspect: 0.16,
    color: "#7E6BAE",
    ...spike({ palette: ["#8A76BC", "#6A559E"], stemColor: "#7C8F5E", stemThickness: 3, density: 16, droop: 8 }),
  },
  {
    id: "fern", name: "Fern frond", hStem: 45, aspect: 0.34,
    color: "#4E6B3C",
    ...frond({ palette: ["#4E6B3C"], stemColor: "#4E6B3C", stemThickness: 4.5, density: 22 }),
  },
  {
    id: "bunny", name: "Bunny tail grass", hStem: 50, aspect: 0.14,
    color: "#EDE4D2",
    ...seedPod({ palette: ["#EDE4D2", "#F7F1E4"], stemColor: "#C9BC9C", stemThickness: 2.5, droop: 10, fuzz: true }),
  },
  {
    id: "rose", name: "Dried rose", hStem: 35, aspect: 0.3,
    color: "#A8555C",
    ...rosette({ palette: ["#A8555C", "#8E3F49", "#C27078"], stemColor: "#6E7B4E", stemThickness: 4, droop: 12 }),
  },
  {
    id: "eucalyptus", name: "Eucalyptus stem", hStem: 55, aspect: 0.3,
    color: "#8FA48B",
    ...leafyBranch({ palette: ["#8FA48B", "#7C927A", "#9A8A6C"], stemColor: "#9A8A6C", stemThickness: 3.5, density: 9, droop: 10, leafShape: "round" }),
  },
  {
    id: "pampas", name: "Pampas plume", hStem: 90, aspect: 0.3,
    color: "#E4D3B8",
    ...plume({ palette: ["#E4D3B8", "#D3BE9C"], stemColor: "#B9A57F", stemThickness: 3, density: 110, droop: 6 }),
  },
  {
    /* Nigella bleached — custom starburst head; no archetype fits a radial crown.
       Head = 12 pointed outer petals + 8 shorter inner petals + fine bract needles.
       Colors sampled from photo: near-white petals, warm straw shadows, tan stem. */
    id: "nigella", name: "Nigella bleached", hStem: 50, aspect: 0.27,
    color: "#F0EAD6",
    /* head scale 0.88; ink reaches 1.39 x the petal length once the
       bracts are counted, so the bud viewBox is sized to exactly that. */
    budRatio: (2 * 1.39 * 34 * 0.88) / 470,
    svg(variant, mono, bend) {
      const petal  = mono || "#F7F3EA";   // near-white petal face
      const shadow = mono || "#E4CFA0";   // warm cream shadow / center
      const bract  = mono || "#D9C28A";   // straw needle bracts
      const stemC  = mono || "#C4A96E";   // tan stem

      /* `spread` is the angular span of the crown.
         On a stem the head is a ~230° fan centred straight up, so the
         flower points up the way it really sits; stemless (bud) it is
         the full 360° star, seen face-on.
         Both variants keep the same petal length in cm — hBud is set so
         the head measures the same whether or not the stem is attached. */
      const head = (cx, cy, s, spread) => {
        const UP = -Math.PI / 2;
        const full = spread >= Math.PI * 2 - 1e-6;
        const angOf = (i, n) => full
          ? UP + (i / n) * Math.PI * 2
          : UP - spread / 2 + spread * (i / (n - 1));
        // petals nearest straight-up run longest, edges of the fan shorter
        const taper = (a) => full ? 1 : 0.70 + 0.30 * Math.cos(a - UP);

        const pl = 34 * s;  // outer petal length
        let f = "";

        const spoke = (a, len, rx, fill, op) => {
          const mx = cx + Math.cos(a) * len * 0.5;
          const my = cy + Math.sin(a) * len * 0.5;
          const deg = (a * 180 / Math.PI) - 90;
          f += `<ellipse cx="${mx}" cy="${my}" rx="${rx}" ry="${len * 0.52}" fill="${fill}" transform="rotate(${deg} ${mx} ${my})"${op ? ` opacity="${op}"` : ""}/>`;
        };

        // ── Thin straw needle-bracts behind the petals
        for (let i = 0; i < 18; i++) {
          const a = angOf(i, 18) + (full ? 0.17 : 0);
          spoke(a, pl * (1.18 + 0.22 * Math.sin(i * 2.7)) * taper(a) * 1.04, 1.8 * s, bract, 0.72);
        }

        // ── Outer petals (narrow pointed ellipses, slight length variation)
        for (let i = 0; i < 12; i++) {
          const a = angOf(i, 12);
          spoke(a, pl * (0.84 + 0.16 * Math.sin(i * 1.9 + 0.6)) * taper(a), 5 * s,
                i % 4 === 0 ? shadow : petal);
        }

        // ── Inner petal whorl (shorter, offset between the outer petals)
        for (let i = 0; i < 8; i++) {
          const a = full ? angOf(i + 0.5, 8) : angOf(i + 0.5, 9);
          spoke(a, pl * 0.54 * taper(a), 6.5 * s, petal, 0.9);
        }

        // ── Center knot
        f += `<circle cx="${cx}" cy="${cy}" r="${8 * s}" fill="${shadow}"/>`;
        f += `<circle cx="${cx}" cy="${cy}" r="${4.5 * s}" fill="${petal}"/>`;
        return f;
      };

      const V = 2 * 1.39 * 34 * 0.88;   // bud viewBox side = full starburst at head scale
      if (variant === "bud") return svgWrap(V, V, head(V / 2, V / 2, 0.88, Math.PI * 2));
      const dx = bendDx(bend, 470);
      const fr = stemFrame(50, 50, 468, 10, dx);
      return padWrap(100, 470, fr.pad(46),
        stemPath(50, 50, 468, 10, stemC, 2.2, dx) +
        fr.crown(head(50, 48, 0.88, Math.PI * 230 / 180), 50, 48));
    },
  },

  /* ── More dried & preserved stems ─────────────────────────────── */
  {
    id: "statice", name: "Statice", hStem: 45, aspect: 0.2,
    color: "#7B5EA7",
    ...spike({ palette: ["#8C6EB8", "#6A4C93"], stemColor: "#8A9367", stemThickness: 3, density: 14, droop: 7, proportions: { floretW: 7, floretH: 4.5, spread: 20, spacing: 10 } }),
  },
  {
    id: "wheat", name: "Wheat ear", hStem: 58, aspect: 0.13,
    color: "#D5B15E",
    ...spike({ palette: ["#DDBB6A", "#C39B47"], stemColor: "#C7B183", stemThickness: 2.5, density: 12, droop: 5, floretShape: "diamond", proportions: { floretW: 5, floretH: 7, spread: 9, spacing: 11 } }),
  },
  {
    id: "strawflower", name: "Strawflower", hStem: 32, aspect: 0.32,
    color: "#E0A02A",
    ...rosette({ palette: ["#E0A02A", "#C2801A", "#F0C25C"], stemColor: "#8A8A57", stemThickness: 3.5, droop: 9 }),
  },
  {
    id: "peony-dried", name: "Dried peony", hStem: 38, aspect: 0.34,
    color: "#C98894",
    ...rosette({ palette: ["#C98894", "#A9636F", "#E0AAB2"], stemColor: "#6E7B4E", stemThickness: 4.5, droop: 10, proportions: { headScale: 1.25 } }),
  },
  {
    id: "gypsophila", name: "Baby's breath", hStem: 40, aspect: 0.34,
    color: "#F2EFE6",
    ...plume({ palette: ["#F7F5EE", "#E4DFD0"], stemColor: "#A8B089", stemThickness: 2, density: 90, droop: 8, proportions: { spread: 46 } }),
  },
  {
    id: "caspia", name: "Caspia", hStem: 44, aspect: 0.32,
    color: "#C7B6D6",
    ...plume({ palette: ["#C7B6D6", "#AFA0C2"], stemColor: "#9A9A7A", stemThickness: 2, density: 100, droop: 9, proportions: { spread: 44 } }),
  },
  {
    id: "broombloom", name: "Broom bloom", hStem: 38, aspect: 0.33,
    color: "#EFE7D2",
    ...plume({ palette: ["#F2EBD8", "#DCD2B8"], stemColor: "#A9A484", stemThickness: 2, density: 80, droop: 7, proportions: { spread: 42 } }),
  },
  {
    id: "setaria", name: "Foxtail (setaria)", hStem: 60, aspect: 0.12,
    color: "#C9B676",
    ...plume({ palette: ["#D2BF80", "#B8A45F"], stemColor: "#A89566", stemThickness: 2.5, density: 130, droop: 14, proportions: { spread: 20 } }),
  },
  {
    id: "amaranthus", name: "Amaranthus", hStem: 55, aspect: 0.3,
    color: "#7E3B45",
    ...plume({ palette: ["#8C424D", "#6B2F38"], stemColor: "#7A6A4E", stemThickness: 3, density: 120, droop: 20, proportions: { spread: 40 } }),
  },
  {
    id: "echinops", name: "Globe thistle", hStem: 62, aspect: 0.2,
    color: "#7C89A8",
    ...ball({ palette: ["#7C89A8", "#94A0BC", "#65728F"], stemColor: "#8A8E6E", stemThickness: 4.5, density: 90, droop: 10, proportions: { headR: 26, dotRMin: 1.2, dotRMax: 2.2 } }),
  },
  {
    id: "yarrow", name: "Yarrow (achillea)", hStem: 52, aspect: 0.3,
    color: "#D6B33C",
    ...ball({ palette: ["#D6B33C", "#E3C55C", "#BE9B24"], stemColor: "#7E8B55", stemThickness: 4, density: 120, droop: 8, proportions: { headR: 34, dotRMin: 2, dotRMax: 3.4 } }),
  },
  {
    id: "gomphrena", name: "Globe amaranth", hStem: 36, aspect: 0.16,
    color: "#B34A82",
    ...ball({ palette: ["#B34A82", "#C86098", "#98376C"], stemColor: "#7E8B55", stemThickness: 3, density: 55, droop: 12, proportions: { headR: 20, dotRMin: 1.4, dotRMax: 2.6 } }),
  },
  {
    id: "poppypod", name: "Poppy seed pod", hStem: 46, aspect: 0.18,
    color: "#9BA68C",
    ...seedPod({ palette: ["#9BA68C", "#B0BA9E"], stemColor: "#8B9476", stemThickness: 3.5, droop: 8, fuzz: false, proportions: { rx: 30, ry: 30, innerRx: 20, innerRy: 18, offsetX: -6, offsetY: -4 } }),
  },
  {
    id: "lagurus-pink", name: "Bunny tail (pink)", hStem: 48, aspect: 0.14,
    color: "#E7C3CB",
    ...seedPod({ palette: ["#E7C3CB", "#F3DCE1"], stemColor: "#C9BC9C", stemThickness: 2.5, droop: 10, fuzz: true }),
  },
  {
    id: "phalaris", name: "Canary grass", hStem: 46, aspect: 0.15,
    color: "#DCCBA6",
    ...seedPod({ palette: ["#DCCBA6", "#EBDFC2"], stemColor: "#B9A87E", stemThickness: 2.2, droop: 12, fuzz: false, proportions: { rx: 18, ry: 34, innerRx: 11, innerRy: 24, offsetX: -5, offsetY: 6 } }),
  },
  {
    id: "ruscus", name: "Ruscus sprig", hStem: 50, aspect: 0.28,
    color: "#4F6B45",
    ...leafyBranch({ palette: ["#4F6B45", "#3E5837", "#6E7A4E"], stemColor: "#6E7A4E", stemThickness: 3, density: 11, droop: 8, leafShape: "oval", proportions: { leafR: 22, spacing: 38, offset: 30 } }),
  },
  {
    id: "ruscus-bleached", name: "Ruscus bleached", hStem: 48, aspect: 0.28,
    color: "#E3DAC4",
    ...leafyBranch({ palette: ["#E8E0CC", "#D6CBB0", "#C3B695"], stemColor: "#C3B695", stemThickness: 3, density: 11, droop: 8, leafShape: "oval", proportions: { leafR: 22, spacing: 38, offset: 30 } }),
  },
  {
    id: "palmspear", name: "Palm spear (bleached)", hStem: 70, aspect: 0.3,
    color: "#E6DCC2",
    ...frond({ palette: ["#E6DCC2"], stemColor: "#D2C4A2", stemThickness: 5, density: 26, proportions: { maxLen: 60, widthTaper: 2.8 } }),
  },
];

/* hBud is never hand-typed. Each generator reports `budRatio` — how much
   of its full-stem drawing the head occupies — so a stemless head comes
   out at exactly the size it is when it is still on its stem.
   budRatio 1 (foliage) means there is no separate head, so the bud/stem
   toggle stays hidden for those. */
const ASSETS = RAW_ASSETS.map(a => ({
  ...a,
  hBud: +(a.hStem * a.budRatio).toFixed(2),
}));

const BLEND_MODES = ["normal", "multiply", "screen", "overlay", "soft-light", "hard-light", "difference", "color-burn", "lighten", "darken"];
const CHROME_STOPS = [
  [0, "#BFD8F0"], [0.32, "#F2F8FF"], [0.47, "#FDFDFA"], [0.5, "#54677E"],
  [0.55, "#2E3B4E"], [0.7, "#7A6247"], [0.86, "#D9BC8C"], [1, "#EFE3C8"],
];

const cmToIn = (cm) => cm / 2.54;
const fmt = (cm, unit) => unit === "in" ? `${cmToIn(cm).toFixed(1)}″` : `${cm.toFixed(0)} cm`;

/* "#FAF9F5" -> "250,249,245", so a picked colour can be used at any alpha. */
const rgbOf = (hex) => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
};
/* The woven threads: fine lines of the mesh colour crossing at right angles. */
const weaveBg = (rgb) =>
  `repeating-linear-gradient(0deg, rgba(${rgb},.9) 0 .5px, transparent .5px 3px),` +
  `repeating-linear-gradient(90deg, rgba(${rgb},.9) 0 .5px, transparent .5px 3px)`;

let _id = 1;
const uid = () => `s${_id++}`;

export default function FlowerCanvasStudio() {
  /* canvas + frame */
  const [unit, setUnit] = useState("in");
  const [canvasW, setCanvasW] = useState(45.7); // 18"
  const [canvasH, setCanvasH] = useState(61);   // 24"
  const [barW, setBarW] = useState(3.8);        // 1.5"
  const [barColor, setBarColor] = useState("#7B5B3A");
  const [meshColor, setMeshColor] = useState("#FAF9F5");   // the fabric itself, dyed or bare
  const [meshOpacity, setMeshOpacity] = useState(0.16);
  const [zoom, setZoom] = useState(7);

  /* tools */
  const [tool, setTool] = useState("select");
  const [brushSize, setBrushSize] = useState(2.5);
  const [brushOpacity, setBrushOpacity] = useState(0.8);
  const [brushShape, setBrushShape] = useState("soft"); // soft | hard | spray
  const [brushColor, setBrushColor] = useState("#1E3A8A");
  const [strokeBlend, setStrokeBlend] = useState("normal"); // blend handed to the next stroke

  /* content — ONE ordered stack holding both flowers and paint strokes.
     Position in the list is depth: earlier entries are deeper in the resin. */
  const [layers, setLayers] = useState([]);
  const [uploads, setUploads] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [uploadH, setUploadH] = useState(30);

  const paintRef = useRef(null);      // live canvas: only ever holds the stroke in progress
  const strokeCv = useRef({});        // layer id -> that stroke's own cropped canvas
  const layersRef = useRef(layers);   // for pointer handlers, which see stale state otherwise
  layersRef.current = layers;
  const meshRef = useRef(null);
  const dragRef = useRef(null);
  const fileRef = useRef(null);

  const allAssets = useMemo(() => [
    ...ASSETS.map(a => ({ ...a, builtin: true })),
    ...uploads,
  ], [uploads]);

  const selected = layers.find(l => l.id === selectedId) || null;
  const meshWpx = canvasW * zoom, meshHpx = canvasH * zoom;

  /* svg cache so random dots don't reshuffle every render */
  const svgCache = useRef({});
  const assetUrl = (asset, variant, mono, bend = 0) => {
    const key = `${asset.id}|${variant}|${mono || ""}|${bend}`;
    if (!svgCache.current[key]) {
      if (asset.builtin) {
        svgCache.current[key] = "data:image/svg+xml;utf8," + encodeURIComponent(asset.svg(variant, mono, bend));
      } else {
        svgCache.current[key] = asset.dataUrl;
      }
    }
    return svgCache.current[key];
  };
  const assetH = (asset, variant) => asset.builtin ? (variant === "bud" ? asset.hBud : asset.hStem) : asset.hCm;

  /* The live canvas only ever holds the stroke being drawn right now, so it
     can simply be resized. Finished strokes carry their own position and size
     in cm, which means they stay physically anchored through a resize for
     free — no re-rastering. */
  useEffect(() => {
    const cv = paintRef.current; if (!cv) return;
    const w = Math.round(canvasW * PAINT_RES), h = Math.round(canvasH * PAINT_RES);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
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
  /* Erasing is not a layer of its own — it lifts paint back out of the stroke
     layers underneath, the way a real eraser does. */
  const eraseAt = (x, y) => {
    const R = (brushSize / 2) * PAINT_RES;
    for (const l of layersRef.current) {
      if (l.kind !== "stroke") continue;
      const cv = strokeCv.current[l.id]; if (!cv) continue;
      const c = cv.getContext("2d");
      c.save();
      c.globalCompositeOperation = "destination-out";
      c.beginPath();
      c.arc(x - l.x * PAINT_RES, y - l.y * PAINT_RES, R, 0, 7);
      c.fillStyle = "#000"; c.fill();
      c.restore();
      dragRef.current.touched.add(l.id);
    }
  };

  /* Lift the finished stroke off the live canvas, crop it to just the pixels
     that were painted, and file it as its own layer. Cropping matters: a full
     artwork-sized canvas per stroke would run to megabytes each. */
  const commitStroke = () => {
    const cv = paintRef.current, ctx = cv.getContext("2d");
    const W = cv.width, H = cv.height;
    const d = ctx.getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (d[(y * W + x) * 4 + 3] > 2) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
    if (x1 < 0) { ctx.clearRect(0, 0, W, H); return; }     // nothing landed
    const pad = 2;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const crop = document.createElement("canvas");
    crop.width = w; crop.height = h;
    crop.getContext("2d").drawImage(cv, x0, y0, w, h, 0, 0, w, h);
    ctx.clearRect(0, 0, W, H);          // only once the pixels are safely copied
    const id = uid();
    strokeCv.current[id] = crop;
    setLayers(v => [...v, {
      kind: "stroke", id,
      x: x0 / PAINT_RES, y: y0 / PAINT_RES,      // cm, top-left — physically anchored
      w: w / PAINT_RES, h: h / PAINT_RES,
      url: crop.toDataURL(), opacity: 1, blend: strokeBlend,
      brush: tool === "chrome" ? "chrome" : brushShape,
      color: tool === "chrome" ? null : brushColor,
    }]);
    setSelectedId(id);
  };

  const refreshTouched = () => {
    const ids = dragRef.current?.touched;
    if (!ids?.size) return;
    setLayers(v => v.map(l => ids.has(l.id)
      ? { ...l, url: strokeCv.current[l.id].toDataURL() } : l));
  };

  const onPaintDown = (e) => {
    if (!["paint", "erase", "chrome"].includes(tool)) return;
    e.target.setPointerCapture(e.pointerId);
    const p = paintPos(e);
    dragRef.current = { painting: true, last: p, touched: new Set() };
    if (tool === "erase") eraseAt(p.x, p.y);
    else dab(paintRef.current.getContext("2d"), p.x, p.y);
  };
  const onPaintMove = (e) => {
    if (!dragRef.current?.painting) return;
    const p = paintPos(e), last = dragRef.current.last;
    const d = Math.hypot(p.x - last.x, p.y - last.y);
    const step = Math.max(2, (brushSize / 2) * PAINT_RES * (brushShape === "soft" ? 0.35 : 0.5));
    const ctx = paintRef.current.getContext("2d");
    for (let t = step; t <= d; t += step) {
      const x = last.x + (p.x - last.x) * t / d, y = last.y + (p.y - last.y) * t / d;
      if (tool === "erase") eraseAt(x, y); else dab(ctx, x, y);
    }
    if (d >= step) dragRef.current.last = p;
  };
  const onPaintUp = () => {
    if (!dragRef.current?.painting) { dragRef.current = null; return; }
    if (tool === "erase") refreshTouched(); else commitStroke();
    dragRef.current = null;
  };

  /* ------- layers ------- */
  const addStamp = (asset) => {
    const s = {
      kind: "flower", id: uid(), assetId: asset.id,
      x: canvasW / 2 + (Math.random() * 6 - 3), y: canvasH / 2 + (Math.random() * 6 - 3),
      scale: 1, rotation: 0, flip: false, opacity: 1, blend: "normal",
      variant: "stem", bend: 0, silhouette: false, silColor: "#111111",
    };
    setLayers(v => [...v, s]); setSelectedId(s.id); setTool("select");
  };
  const patch = (id, up) => setLayers(v => v.map(l => l.id === id ? { ...l, ...up } : l));
  const removeLayer = (id) => {
    setLayers(v => v.filter(l => l.id !== id));
    delete strokeCv.current[id];
    if (selectedId === id) setSelectedId(null);
  };
  const moveLayer = (id, dir) => setLayers(v => {
    const i = v.findIndex(l => l.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= v.length) return v;
    const n = [...v]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });
  const clearPaint = () => {
    setLayers(v => v.filter(l => l.kind !== "stroke"));
    strokeCv.current = {};
  };

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
          !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) removeLayer(selectedId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* Punch a flower's shape out of the paint — spraying over a stencil and
     lifting it. It bites every stroke layer, each in its own coordinates. */
  const punchOut = async (s) => {
    const asset = allAssets.find(a => a.id === s.assetId); if (!asset) return;
    const img = new Image();
    img.src = assetUrl(asset, s.variant, asset.builtin ? "#000" : null, s.bend);
    await img.decode();
    const hPx = assetH(asset, s.variant) * s.scale * PAINT_RES;
    const wPx = hPx * (img.width / img.height);
    const hit = new Set();
    for (const l of layersRef.current) {
      if (l.kind !== "stroke") continue;
      const cv = strokeCv.current[l.id]; if (!cv) continue;
      const ctx = cv.getContext("2d");
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.globalAlpha = 1;
      ctx.translate(s.x * PAINT_RES - l.x * PAINT_RES, s.y * PAINT_RES - l.y * PAINT_RES);
      ctx.rotate(s.rotation * Math.PI / 180);
      ctx.scale(s.flip ? -1 : 1, 1);
      ctx.drawImage(img, -wPx / 2, -hPx / 2, wPx, hPx);
      ctx.restore();
      hit.add(l.id);
    }
    if (hit.size) setLayers(v => v.map(l => hit.has(l.id)
      ? { ...l, url: strokeCv.current[l.id].toDataURL() } : l));
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
    /* the open middle of the frame is wall, then the sheer mesh washes over it */
    ctx.fillStyle = WALL.flat; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = `rgba(${rgbOf(meshColor)},${meshOpacity})`; ctx.fillRect(0, 0, W, H);

    /* one pass down the stack, so strokes and flowers export in exactly the
       order they are stacked on screen */
    for (const l of layers) {
      if (l.kind === "stroke") {
        const cv = strokeCv.current[l.id]; if (!cv) continue;
        ctx.save();
        ctx.globalAlpha = l.opacity;
        ctx.globalCompositeOperation = l.blend === "normal" ? "source-over" : l.blend;
        ctx.drawImage(cv, l.x * R, l.y * R, l.w * R, l.h * R);
        ctx.restore();
        continue;
      }
      const asset = allAssets.find(a => a.id === l.assetId); if (!asset) continue;
      const img = new Image();
      img.src = assetUrl(asset, l.variant, l.silhouette && asset.builtin ? l.silColor : null, l.bend);
      try { await img.decode(); } catch { continue; }
      const hPx = assetH(asset, l.variant) * l.scale * R;
      const wPx = hPx * (img.width / img.height);
      let src = img;
      if (l.silhouette && !asset.builtin) {
        const t = document.createElement("canvas");
        t.width = img.width; t.height = img.height;
        const tc = t.getContext("2d");
        tc.drawImage(img, 0, 0);
        tc.globalCompositeOperation = "source-in";
        tc.fillStyle = l.silColor; tc.fillRect(0, 0, t.width, t.height);
        src = t;
      }
      ctx.save();
      ctx.globalAlpha = l.opacity;
      ctx.globalCompositeOperation = l.blend === "normal" ? "source-over" : l.blend;
      ctx.translate(l.x * R, l.y * R);
      ctx.rotate(l.rotation * Math.PI / 180);
      ctx.scale(l.flip ? -1 : 1, 1);
      ctx.drawImage(src, -wPx / 2, -hPx / 2, wPx, hPx);
      ctx.restore();
    }
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
          {/* Bars are drawn as a border, not a filled box, so the middle of the
              frame stays open and the wall — not the wood — shows through the mesh. */}
          <div style={{ ...S.frame, borderWidth: barW * zoom, borderStyle: "solid", borderColor: barColor }}>
            <div style={{ ...S.frameGrain, inset: -(barW * zoom) }} />
            <div ref={meshRef} style={{
              ...S.mesh, width: meshWpx, height: meshHpx,
              /* the fabric's own tint — kept translucent so the wall reads through */
              background: `rgba(${rgbOf(meshColor)},${meshOpacity})`,
            }}>
              <div style={{ ...S.meshWeave, opacity: meshOpacity * 2.2, background: weaveBg(rgbOf(meshColor)) }} />
              <div style={S.meshSheen} />
              {layers.map((l, i) => {
                const picked = l.id === selectedId;
                if (l.kind === "stroke") {
                  return (
                    <img key={l.id} src={l.url} alt="paint stroke" draggable={false}
                      onPointerDown={e => onStampDown(e, l)} onPointerMove={onStampMove}
                      onPointerUp={() => (dragRef.current = null)}
                      style={{
                        position: "absolute", left: l.x * zoom, top: l.y * zoom,
                        width: l.w * zoom, height: l.h * zoom, zIndex: i + 1,
                        opacity: l.opacity, mixBlendMode: l.blend,
                        outline: picked ? "2px dashed #4A5D3A" : "none", outlineOffset: 2,
                        cursor: tool === "select" ? "grab" : "default",
                        pointerEvents: tool === "select" ? "auto" : "none",
                        touchAction: "none", userSelect: "none",
                      }} />
                  );
                }
                const asset = allAssets.find(a => a.id === l.assetId); if (!asset) return null;
                const hPx = assetH(asset, l.variant) * l.scale * zoom;
                const sil = l.silhouette;
                const url = assetUrl(asset, l.variant, sil && asset.builtin ? l.silColor : null, l.bend);
                const uploadFilter = sil && !asset.builtin
                  ? (l.silColor === "#FFFFFF" ? "brightness(0) invert(1)" : "brightness(0)") : "none";
                return (
                  <img key={l.id} src={url} alt={asset.name} draggable={false}
                    onPointerDown={e => onStampDown(e, l)} onPointerMove={onStampMove}
                    onPointerUp={() => (dragRef.current = null)}
                    style={{
                      position: "absolute", left: l.x * zoom, top: l.y * zoom,
                      height: hPx, zIndex: i + 1,
                      transform: `translate(-50%,-50%) rotate(${l.rotation}deg) scaleX(${l.flip ? -1 : 1})`,
                      opacity: l.opacity, mixBlendMode: l.blend,
                      filter: uploadFilter,
                      outline: picked ? "2px dashed #4A5D3A" : "none",
                      outlineOffset: 3,
                      cursor: tool === "select" ? "grab" : "default",
                      pointerEvents: tool === "select" ? "auto" : "none",
                      touchAction: "none", userSelect: "none",
                    }} />
                );
              })}
              {/* live stroke sits above everything while the pen is down, then
                  becomes its own layer on release */}
              <canvas
                ref={paintRef}
                style={{ ...S.paint, zIndex: layers.length + 2,
                  pointerEvents: tool === "select" ? "none" : "auto",
                  cursor: "crosshair" }}
                onPointerDown={onPaintDown} onPointerMove={onPaintMove}
                onPointerUp={onPaintUp} onPointerCancel={onPaintUp}
              />
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
          <div style={S.row}>
            <label style={S.mini}>Mesh color <input type="color" value={meshColor} onChange={e => setMeshColor(e.target.value)} /></label>
            <button style={S.btn} onClick={() => setMeshColor("#FAF9F5")}>bare</button>
          </div>
          <label style={S.slider}>
            Mesh opacity — {(meshOpacity * 100) | 0}% {meshOpacity < 0.02 ? "(invisible)" : meshOpacity > 0.9 ? "(solid)" : ""}
            <input type="range" min="0" max="1" step="0.01" value={meshOpacity} onChange={e => setMeshOpacity(+e.target.value)} />
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
            {tool !== "erase" && <>
              <label style={S.mini}>New stroke blend <select style={S.select} value={strokeBlend}
                onChange={e => setStrokeBlend(e.target.value)}>
                {BLEND_MODES.map(m => <option key={m}>{m}</option>)}</select></label>
              <p style={S.hint}>Every stroke lands as its own layer. Switch to Select to
                restack it, change its blend, or move it.</p>
            </>}
            {tool === "erase" && <p style={S.hint}>The eraser lifts paint out of the stroke
              layers underneath rather than adding a layer of its own.</p>}
            <button style={S.btn} onClick={clearPaint}>Clear all paint strokes</button>
          </>)}

          {/* ---- the stack ---- */}
          <div style={S.sectionLabel}>Layers — deepest first</div>
          {layers.length === 0
            ? <p style={S.hint}>Nothing yet. Add a flower or paint a stroke.</p>
            : <div style={S.layerList}>
                {layers.map((l, i) => {
                  const asset = l.kind === "flower" ? allAssets.find(a => a.id === l.assetId) : null;
                  return (
                    <button key={l.id} onClick={() => { setSelectedId(l.id); setTool("select"); }}
                      style={{ ...S.layerRow, ...(l.id === selectedId ? S.layerRowOn : {}) }}>
                      <span style={S.layerNum}>{layers.length - i}</span>
                      <span style={S.layerName}>
                        {l.kind === "stroke" ? `${l.brush} stroke` : (asset?.name || "flower")}
                      </span>
                      {l.blend !== "normal" && <span style={S.layerTag}>{l.blend}</span>}
                    </button>
                  );
                })}
              </div>}

          {selected?.kind === "stroke" && (<>
            <div style={S.sectionLabel}>{selected.brush} stroke</div>
            <div style={S.libDim}>covers <b>{fmt(selected.w, unit)} × {fmt(selected.h, unit)}</b></div>
            <label style={S.slider}>Opacity — {(selected.opacity * 100) | 0}%
              <input type="range" min="0.05" max="1" step="0.05" value={selected.opacity}
                onChange={e => patch(selected.id, { opacity: +e.target.value })} />
            </label>
            <label style={S.mini}>Blend <select style={S.select} value={selected.blend}
              onChange={e => patch(selected.id, { blend: e.target.value })}>
              {BLEND_MODES.map(m => <option key={m}>{m}</option>)}</select></label>
            <div style={S.row}>
              <button style={S.btn} onClick={() => moveLayer(selected.id, -1)}>Send back</button>
              <button style={S.btn} onClick={() => moveLayer(selected.id, +1)}>Bring forward</button>
            </div>
            <button style={{ ...S.btn, color: "#8E3F49" }} onClick={() => removeLayer(selected.id)}>Delete stroke</button>
          </>)}

          {selected?.kind === "flower" && (() => {
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
              {asset?.builtin && selected.variant !== "bud" && (
                <label style={S.slider}>
                  Stem bend — {selected.bend ? `${fmt(Math.abs(selected.bend) * BEND_REACH * realH, unit)} ${selected.bend < 0 ? "left" : "right"}` : "straight"}
                  <input type="range" min="-1" max="1" step="0.05" value={selected.bend ?? 0}
                    onChange={e => patch(selected.id, { bend: +e.target.value })} />
                </label>
              )}
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
                  setLayers(v => [...v, c]); setSelectedId(c.id);
                }}>Duplicate</button>
              </div>
              <div style={S.row}>
                <button style={S.btn} onClick={() => moveLayer(selected.id, -1)}>Send back</button>
                <button style={S.btn} onClick={() => moveLayer(selected.id, +1)}>Bring forward</button>
              </div>
              <button style={S.btn} onClick={() => punchOut(selected)}
                title="Erases this flower's shape from every paint stroke — like lifting a stencil after spraying">
                Punch out of paint (stencil lift)</button>
              <button style={{ ...S.btn, color: "#8E3F49" }} onClick={() => removeLayer(selected.id)}>Delete</button>
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
const layerStyles = {
  layerList: { display: "flex", flexDirection: "column", gap: 2, maxHeight: 190, overflowY: "auto", marginBottom: 6 },
  layerRow: { display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left",
    padding: "4px 6px", border: "1px solid #DCDACE", borderRadius: 3, background: "#FBFAF6",
    font: "inherit", fontSize: 11, color: "#23281F", cursor: "pointer" },
  layerRowOn: { background: "#E7EBDF", borderColor: "#4A5D3A" },
  layerNum: { minWidth: 16, color: "#8A8B80", fontSize: 10 },
  layerName: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  layerTag: { fontSize: 9, color: "#4A5D3A", background: "#E7EBDF", borderRadius: 2, padding: "1px 4px" },
};
const panelBg = "#F3F2EC";
const ink = "#23281F";
const styles = {
  ...layerStyles,
  app: { display: "flex", flexDirection: "column", height: "100vh", fontFamily: "'Avenir Next','Segoe UI',system-ui,sans-serif", color: ink, background: "#DAD5C9" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", background: panelBg, borderBottom: "1px solid #C9C4B6" },
  title: { fontFamily: "Georgia,'Times New Roman',serif", fontSize: 19, letterSpacing: 0.3 },
  sub: { fontSize: 11, color: "#6B7060", letterSpacing: 0.6, textTransform: "uppercase" },
  body: { display: "flex", flex: 1, minHeight: 0 },
  left: { width: 230, background: panelBg, borderRight: "1px solid #C9C4B6", padding: 12, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 },
  right: { width: 250, background: panelBg, borderLeft: "1px solid #C9C4B6", padding: 12, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 },
  stage: { flex: 1, overflow: "auto", display: "grid", placeItems: "center", padding: 40, background: `radial-gradient(120% 100% at 50% 0%, ${WALL.light} 0%, ${WALL.dark} 100%)` },
  frame: { position: "relative", boxShadow: "0 18px 40px rgba(40,35,25,.35), 0 2px 6px rgba(40,35,25,.25)", borderRadius: 2 },
  frameGrain: { position: "absolute", inset: 0, borderRadius: 2, pointerEvents: "none", background: "repeating-linear-gradient(92deg, rgba(255,255,255,.06) 0 2px, rgba(0,0,0,.07) 2px 5px)", mixBlendMode: "overlay" },
  mesh: { position: "relative", overflow: "hidden", background: "transparent", boxShadow: "inset 0 0 22px rgba(30,25,15,.28)" },
  /* background is supplied inline from meshColor — see weaveBg() */
  meshWeave: { position: "absolute", inset: 0, pointerEvents: "none", zIndex: 400 },
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
