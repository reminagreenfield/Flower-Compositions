# CLAUDE.md — Flower Canvas Studio

## What this project is

A design mockup tool for real artworks I make in my studio: dried and
preserved flowers embedded in UV resin on sheer, transparent fabric
(silkscreen mesh) stretched over wood stretcher bars. Resin is painted
over the mesh to create a clear, drum-like surface, and I can layer more
flowers and resin on top of cured layers. The app lets me compose and
imagine these pieces before I build them physically.

I am an artist, not a programmer. Explain what you changed in one or two
plain sentences. Never assume I know programming terms.

## Physical rules — never break these

- **Dimensional accuracy is the whole point.** All sizes are stored in
  real-world centimeters. Every flower asset has a true real-life height
  (`hStem` / `hBud` for built-ins, `hCm` for uploads). A 60 cm craspedia
  stem must always render at 60 cm relative to the canvas dimensions.
  Zoom changes how big things look on screen, never their real size.
- **The canvas is translucent**, not white. It reads like sheer mesh with
  resin over it — you can see the wall through it. Keep the mesh weave,
  sheen, and adjustable mesh opacity.
- **Stretcher bars are physical objects** with real width (cm) and a wood
  color. They frame the mesh; their size affects the outer dimensions.
- Layer order matters physically: things lower in the stamp list are
  "deeper in the resin." If we add depth effects, deeper = slightly
  blurred/dimmed, like looking through cured resin.

## Architecture (current)

- Single React component in `src/flower-canvas-studio.jsx`. Keep it in
  one file unless it becomes genuinely unwieldy; if splitting, ask first.
- No external UI libraries. Inline styles in the `styles` object at the
  bottom. Palette: linen panels (#F3F2EC), ink text (#23281F), moss
  accent (#4A5D3A), plaster-wall stage background.
- Key constants: `PAINT_RES = 8` px/cm (paint raster), `EXPORT_RES = 12`
  px/cm (PNG export). Internal unit is always cm; the UI can display
  inches (`unit` state, `cmToIn`, `fmt`).
- Built-in flowers are procedural SVG generators in the `ASSETS` array,
  each with `stem` and `bud` variants and a `mono` parameter that renders
  a flat-color stencil silhouette.
- Stamps: `{id, assetId, x, y (cm, center), scale, rotation, flip,
  opacity, blend, variant, silhouette, silColor}`. Rendered as positioned
  images with CSS `mix-blend-mode`; export maps these to canvas
  `globalCompositeOperation`.
- Paint layer: one `<canvas>` at PAINT_RES, physically anchored (resizing
  the artwork preserves painted content at true scale). Brushes: soft,
  hard, spray, eraser, plus a chrome brush that fills dabs with a shared
  horizon gradient (`CHROME_STOPS`) so strokes align into one mirror.
- "Punch out of paint" erases a flower's alpha from the paint layer —
  simulates spraying over a stencil and lifting it. Preserve this.

## Conventions

- New features must work in both units and survive canvas resizing.
- Anything with a size gets a real-world unit, shown in the UI.
- Test visually with `npm run dev` open; small commits, one feature each.
- If a change could alter how existing saved compositions look, warn me.

## Roadmap (rough priority)

1. Save/load projects (compositions currently vanish on refresh)
2. Drag-corner resize/rotate handles on flowers instead of sliders
3. Bulk asset import: read `manifest.csv` + a folder of transparent PNGs
   from my Abraflora pipeline (`make_flower_assets.py`) in one shot
4. Resin-layer depth: group stamps into layers with blur/dim between
5. Stylus pressure for brushes (iPad/pen tablet)
