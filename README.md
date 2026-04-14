# fvtt-paint-layer

A Foundry VTT **V13** module that adds a raster paint layer to the canvas — MS Paint-style freehand drawing directly on scenes, persisted as uploaded image assets.

## Features (v0.1 draft)

- Dedicated **Paint** control group in the scene controls toolbar
- **Brush**, **Eraser**, **Flood Fill**, **Undo**, **Redo**, **Save**, and **Clear** tools
- Color picker and brush-size slider in a floating panel while the layer is active
- Offscreen 2D canvas painting (capped at 4096×4096 per side) rendered into the scene as a PIXI sprite
- **Auto-save** (debounced) to `data/paint-layer/paint-{sceneId}.png` and the URL is stored on `scene.flags.fvtt-paint-layer.paintImageUrl`
- On scene load, paint is rehydrated from the saved PNG
- GM-only painting (players see the layer, but do not write)

## Install

1. Download the `fvtt-paint-layer.zip` release.
2. In Foundry: **Add-on Modules → Install Module → Manifest URL** or drop the folder into `Data/modules/`.
3. Enable the module in your world.

## Development

No bundler required — the module is plain ES modules. Layout:

```
fvtt-paint-layer/
├── module.json
├── paint-layer.js
├── src/
│   ├── PaintLayer.js
│   ├── PaintCanvas.js
│   ├── PaintToolbar.js
│   └── PaintSync.js
├── styles/paint-layer.css
└── lang/en.json
```

## Status

First draft. Multi-user live stroke sync, non-GM permissions, and per-layer opacity are deferred to later versions.
