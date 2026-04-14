# fvtt-paint-layer

A Foundry VTT V13 module that adds a raster paint layer to the canvas — MS Paint-style freehand drawing directly on scenes, persisted as uploaded image assets.

## Project Structure

```
fvtt-paint-layer/
├── module.json
├── paint-layer.js          # Main entry point + module registration
├── src/
│   ├── PaintLayer.js       # InteractionLayer subclass
│   ├── PaintCanvas.js      # Offscreen canvas + 2D paint engine
│   ├── PaintToolbar.js     # SceneControls integration (brush, eraser, fill, color)
│   └── PaintSync.js        # Persistence: FilePicker.upload + scene flags for URL
├── styles/
│   └── paint-layer.css
└── lang/
    └── en.json
```

## Platform Context

- **Foundry version:** V13 stable (ApplicationV2 era)
- **PIXI version:** V8 (bundled with Foundry V13)
- **System:** Any (system-agnostic utility module)
- **Module ID:** `fvtt-paint-layer`
- **Compatibility:** `"minimum": "13", "verified": "13"`
- **Hosted on:** Forge-VTT (forge-vtt.com) — zip upload workflow

## Architecture

### Layer Stack
- Registered via `CONFIG.Canvas.layers.paint`
- Group: `"interface"` — renders above tokens, below UI chrome
- zIndex: 180 (above Drawings at 170, below Interface at 200)
- Class extends `InteractionLayer` (not `PlaceablesLayer`)

### Paint Engine (PaintCanvas.js)
- Maintains a single **offscreen `<canvas>`** (never in DOM)
- Size matches `canvas.dimensions.sceneWidth` × `canvas.dimensions.sceneHeight`
- Uses **Canvas 2D API** for all draw ops (no PIXI Graphics)
- Exposes: `startStroke(x, y)`, `continueStroke(x, y)`, `endStroke()`, `floodFill(x, y, color)`, `erase(x, y, size)`, `clear()`, `undo()`, `redo()`
- Undo stack: snapshots of `ImageData` (cap at 20 states)

### PIXI Integration (PaintLayer.js)
- Holds a `PIXI.Sprite` backed by a `PIXI.Texture` created from the offscreen canvas
- Texture update: `texture.update()` called via `requestAnimationFrame` throttle (~30fps) during active stroke only
- Sprite positioned at `canvas.dimensions.sceneRect.x, .y`

### Coordinate Mapping
All pointer events arrive in **screen space**. Convert to **scene canvas space**:
```js
// In pointer event handlers on the InteractionLayer:
const point = canvas.stage.transform.worldTransform.applyInverse(
  { x: event.clientX, y: event.clientY }
);
// Then offset by scene origin:
const px = point.x - canvas.dimensions.sceneRect.x;
const py = point.y - canvas.dimensions.sceneRect.y;
```
Use `canvas.app.renderer.events` (PIXI EventSystem, V13) — not the deprecated InteractionManager.

### Persistence (PaintSync.js)
- On `endStroke()` (debounced 2s) and on explicit "Save" button:
  1. `offscreenCanvas.toBlob()` → PNG
  2. `FilePicker.upload("data", "paint-layer/", file, { notify: false })`
  3. Store returned URL in `scene.setFlag("fvtt-paint-layer", "paintImageUrl", url)`
- On scene load (`canvasReady` hook): read flag → load texture from URL → apply to Sprite
- File naming: `paint-{sceneId}.png` (overwrites on each save)
- GM-only write: gate `FilePicker.upload` behind `game.user.isGM` check; non-GMs see read-only layer

### Toolbar (PaintToolbar.js)
- Hook: `getSceneControlButtons`
- Tool group name: `"paint"`
- Tools: `brush`, `eraser`, `fill` (flood fill), `clear` (with confirm dialog)
- Sub-controls: color picker (HTML `<input type="color">` in a floating panel), brush size slider
- Active tool stored in `game.activeTool` via standard Foundry control system

## Key Foundry V13 APIs

```js
// Layer registration
Hooks.once("init", () => {
  CONFIG.Canvas.layers.paint = {
    layerClass: PaintLayer,
    group: "interface"
  };
});

// Pointer events (V13 PIXI EventSystem)
this.eventMode = "static";
this.on("pointerdown", this._onPointerDown.bind(this));
this.on("pointermove", this._onPointerMove.bind(this));
this.on("pointerup", this._onPointerUp.bind(this));

// Activate/deactivate layer
// PaintLayer must implement: _activate(), _deactivate()

// File upload
const response = await FilePicker.upload("data", "paint-layer", blob, filename, { notify: false });
// response.path is the stored URL

// Scene flags
await scene.setFlag("fvtt-paint-layer", "paintImageUrl", path);
const url = scene.getFlag("fvtt-paint-layer", "paintImageUrl");
```

## Constraints & Gotchas

- **No nested `<form>` tags** — AppV2 wraps sheets in a form automatically
- **`InteractionLayer` does not manage Documents** — do not call `super.draw()` expecting PlaceablesLayer behavior
- **PIXI V8:** `PIXI.Texture.from()` is deprecated — use `PIXI.Texture.fromURL()` for async loads or create via `new PIXI.Texture(new PIXI.ImageSource(...))`
- **Forge-VTT uploads:** `FilePicker.upload` works on Forge; target path `"paint-layer/"` must exist or be created first — check/create with `FilePicker.createDirectory`
- **Canvas not ready at `init`:** Never access `canvas.dimensions` before `canvasReady` hook
- **Layer visibility:** Toggle layer visibility (hide paint during token drag, etc.) via `this.visible = bool`
- **Large scenes:** Cap offscreen canvas at 4096×4096 — scale down proportionally and compensate in coordinate mapping if scene exceeds this

## Hooks Used

| Hook | Purpose |
|---|---|
| `init` | Register `CONFIG.Canvas.layers.paint` |
| `canvasReady` | Initialize PaintLayer, load saved image from scene flag |
| `getSceneControlButtons` | Inject paint toolbar controls |
| `updateScene` | React to scene flag changes (for future multi-user sync) |
| `closeApplication` | Save before unload (best-effort) |

## Build & Delivery

- No bundler required — plain ES modules with `"type": "module"` in module.json `"esmodules"`
- Deliver as: `fvtt-paint-layer.zip` containing `fvtt-paint-layer/` folder
- Module zip structure: `fvtt-paint-layer/module.json`, `fvtt-paint-layer/paint-layer.js`, etc.
- For Forge upload: zip must have the module-id folder as root inside the zip

## Out of Scope (V1)

- Multi-user real-time sync (future: socket-based stroke broadcast)
- Per-layer opacity control
- Non-GM painting (permissions model deferred)
- Import/export to Journal or tiles
