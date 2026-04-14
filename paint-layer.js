/**
 * fvtt-paint-layer — main entry point
 *
 * Registers the paint layer with Foundry's canvas, wires up toolbar
 * controls, and coordinates scene-load persistence.
 */

import { PaintLayer } from "./src/PaintLayer.js";
import { registerPaintToolbar } from "./src/PaintToolbar.js";
import { PaintSync } from "./src/PaintSync.js";

export const MODULE_ID = "fvtt-paint-layer";

// Expose the module namespace early so other modules / macros can access it.
globalThis.fvttPaintLayer = {
  MODULE_ID,
  PaintLayer,
  PaintSync
};

/* -------------------------------------------- */
/*  init                                        */
/* -------------------------------------------- */

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);

  // Register the paint layer in the canvas layer stack.
  // Group "interface" renders above tokens, below UI chrome.
  CONFIG.Canvas.layers.paint = {
    layerClass: PaintLayer,
    group: "interface"
  };

  // Register client settings (brush color/size persist per-user).
  game.settings.register(MODULE_ID, "brushColor", {
    scope: "client",
    config: false,
    type: String,
    default: "#ff0000"
  });

  game.settings.register(MODULE_ID, "brushSize", {
    scope: "client",
    config: false,
    type: Number,
    default: 8
  });

  // World setting: debounce window for auto-save.
  game.settings.register(MODULE_ID, "autoSaveDelay", {
    name: "FVTT_PAINT_LAYER.Settings.AutoSaveDelay.Name",
    hint: "FVTT_PAINT_LAYER.Settings.AutoSaveDelay.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: 2000,
    range: { min: 500, max: 10000, step: 500 }
  });
});

/* -------------------------------------------- */
/*  canvasReady                                 */
/* -------------------------------------------- */

Hooks.on("canvasReady", async () => {
  const layer = canvas.paint;
  if (!layer) {
    console.warn(`${MODULE_ID} | paint layer not found on canvas`);
    return;
  }
  await layer.initializePaintSurface();
  await layer.loadFromScene(canvas.scene);
});

/* -------------------------------------------- */
/*  getSceneControlButtons                      */
/* -------------------------------------------- */

Hooks.on("getSceneControlButtons", (controls) => {
  registerPaintToolbar(controls);
});

/* -------------------------------------------- */
/*  updateScene — react to remote paint changes */
/* -------------------------------------------- */

Hooks.on("updateScene", async (scene, changes) => {
  if (scene.id !== canvas.scene?.id) return;
  const flagChange = foundry.utils.getProperty(
    changes,
    `flags.${MODULE_ID}.paintImageUrl`
  );
  if (flagChange === undefined) return;

  const layer = canvas.paint;
  if (!layer) return;
  // Skip reload if this client originated the update (PaintSync tags it).
  if (layer._suppressNextFlagReload) {
    layer._suppressNextFlagReload = false;
    return;
  }
  await layer.loadFromScene(scene);
});

/* -------------------------------------------- */
/*  Best-effort save before page unload         */
/* -------------------------------------------- */

window.addEventListener("beforeunload", () => {
  const layer = canvas?.paint;
  if (layer && layer.isDirty && game.user.isGM) {
    // Fire-and-forget; browser may not wait for the promise.
    layer.sync?.flushNow?.();
  }
});
