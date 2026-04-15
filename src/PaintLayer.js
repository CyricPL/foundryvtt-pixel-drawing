/**
 * PaintLayer — Foundry V13 InteractionLayer subclass.
 *
 * Owns a PIXI.Sprite backed by an offscreen 2D paint canvas and forwards
 * pointer events to PaintCanvas while the layer is active.
 */

import { PaintCanvas } from "./PaintCanvas.js";
import { PaintSync } from "./PaintSync.js";
import { MODULE_ID } from "../paint-layer.js";

const { InteractionLayer } = foundry.canvas.layers;

export class PaintLayer extends InteractionLayer {
  constructor() {
    super();

    /** @type {PaintCanvas|null} */
    this.paintCanvas = null;
    /** @type {PIXI.Sprite|null} */
    this.sprite = null;
    /** @type {PIXI.Texture|null} */
    this.texture = null;
    /** @type {PaintSync|null} */
    this.sync = null;

    /** Current tool & brush options (populated from toolbar / settings). */
    this.tool = "brush";
    this.color = "#ff0000";
    this.brushSize = 8;

    /** Dirty flag — something painted since last save. */
    this.isDirty = false;

    /** Internal flags */
    this._isDrawing = false;
    this._textureUpdateScheduled = false;
    this._suppressNextFlagReload = false;
  }

  /* -------------------------------------------- */
  /*  Static layer options                        */
  /* -------------------------------------------- */

  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, {
      name: "paint",
      zIndex: 180
    });
  }

  /* -------------------------------------------- */
  /*  Foundry lifecycle                           */
  /* -------------------------------------------- */

  /** @override */
  async _draw(options) {
    // InteractionLayer has no default children to draw; we build the
    // sprite lazily from initializePaintSurface().
    await super._draw?.(options);
  }

  /** @override */
  async _tearDown(options) {
    this._destroyPaintSurface();
    await super._tearDown?.(options);
  }

  /** @override */
  _activate() {
    super._activate?.();
    this.eventMode = "static";
    // Give the layer a hit area covering the scene rect so it receives events.
    if (canvas.dimensions) {
      const r = canvas.dimensions.sceneRect;
      this.hitArea = new PIXI.Rectangle(r.x, r.y, r.width, r.height);
    }
    this._bindPointerEvents();
    this.visible = true;
  }

  /** @override */
  _deactivate() {
    super._deactivate?.();
    this.eventMode = "passive";
    this.hitArea = null;
    this._unbindPointerEvents();
    // Leave the sprite visible so players can see the paint when another
    // layer is active — visibility toggling is a separate concern.
  }

  /* -------------------------------------------- */
  /*  Paint surface lifecycle                     */
  /* -------------------------------------------- */

  async initializePaintSurface() {
    this._destroyPaintSurface();
    if (!canvas.dimensions) return;

    const { sceneWidth, sceneHeight, sceneRect } = canvas.dimensions;
    this.paintCanvas = new PaintCanvas(sceneWidth, sceneHeight);

    // Build a PIXI texture from the offscreen HTMLCanvasElement.
    // In PIXI v8 the ImageSource wrapper is used by Texture internally;
    // passing the canvas element directly is supported.
    this.texture = PIXI.Texture.from(this.paintCanvas.canvas);

    this.sprite = new PIXI.Sprite(this.texture);
    this.sprite.x = sceneRect.x;
    this.sprite.y = sceneRect.y;
    this.sprite.width = sceneWidth;
    this.sprite.height = sceneHeight;
    this.addChild(this.sprite);

    this.sync = new PaintSync(this);

    // Apply saved brush settings.
    this.color = game.settings.get(MODULE_ID, "brushColor");
    this.brushSize = game.settings.get(MODULE_ID, "brushSize");
  }

  _destroyPaintSurface() {
    if (this.sync) {
      this.sync.cancelPending();
      this.sync = null;
    }
    if (this.sprite) {
      this.removeChild(this.sprite);
      this.sprite.destroy({ children: true });
      this.sprite = null;
    }
    if (this.texture) {
      this.texture.destroy(false);
      this.texture = null;
    }
    this.paintCanvas = null;
    this.isDirty = false;
  }

  /* -------------------------------------------- */
  /*  Load saved paint from the scene flag        */
  /* -------------------------------------------- */

  async loadFromScene(scene) {
    if (!scene || !this.paintCanvas) return;
    const url = scene.getFlag(MODULE_ID, "paintImageUrl");
    if (!url) return;

    try {
      const img = await loadImageFromUrl(url);
      this.paintCanvas.drawImage(img);
      this._markTextureDirty(true);
    } catch (err) {
      console.error(`${MODULE_ID} | failed to load paint image`, err);
    }
  }

  /* -------------------------------------------- */
  /*  Pointer event plumbing                      */
  /* -------------------------------------------- */

  _bindPointerEvents() {
    this._onDown = this._onPointerDown.bind(this);
    this._onMove = this._onPointerMove.bind(this);
    this._onUp = this._onPointerUp.bind(this);
    this.on("pointerdown", this._onDown);
    this.on("pointermove", this._onMove);
    this.on("pointerup", this._onUp);
    this.on("pointerupoutside", this._onUp);
  }

  _unbindPointerEvents() {
    if (this._onDown) this.off("pointerdown", this._onDown);
    if (this._onMove) this.off("pointermove", this._onMove);
    if (this._onUp) {
      this.off("pointerup", this._onUp);
      this.off("pointerupoutside", this._onUp);
    }
    this._onDown = this._onMove = this._onUp = null;
  }

  _eventToScenePoint(event) {
    // PIXI v8 events carry a `global` point in stage-world coords.
    const global = event.data?.global ?? event.global;
    if (!global) return null;
    const world = canvas.stage.toLocal(global);
    const r = canvas.dimensions.sceneRect;
    return { x: world.x - r.x, y: world.y - r.y, worldX: world.x, worldY: world.y };
  }

  _onPointerDown(event) {
    if (!this._canPaint()) return;
    const p = this._eventToScenePoint(event);
    if (!p) return;

    if (this.tool === "fill") {
      this.paintCanvas.floodFill(p.x, p.y, this.color);
      this._markTextureDirty(true);
      this._flagDirty();
      this.sync?.scheduleSave();
      return;
    }

    const mode = this.tool === "eraser" ? "eraser" : "brush";
    this.paintCanvas.startStroke(p.x, p.y, {
      color: this.color,
      size: this.brushSize,
      mode
    });
    this._isDrawing = true;
    this._markTextureDirty(false);
  }

  _onPointerMove(event) {
    if (!this._isDrawing) return;
    const p = this._eventToScenePoint(event);
    if (!p) return;
    this.paintCanvas.continueStroke(p.x, p.y);
    this._markTextureDirty(false);
  }

  _onPointerUp(_event) {
    if (!this._isDrawing) return;
    this._isDrawing = false;
    this.paintCanvas.endStroke();
    this._markTextureDirty(true);
    this._flagDirty();
    this.sync?.scheduleSave();
  }

  /* -------------------------------------------- */
  /*  Tool / brush setters (called from toolbar)  */
  /* -------------------------------------------- */

  setTool(tool) { this.tool = tool; }

  async setColor(color) {
    this.color = color;
    if (game.user) await game.settings.set(MODULE_ID, "brushColor", color);
  }

  async setBrushSize(size) {
    this.brushSize = Number(size) || 1;
    if (game.user) await game.settings.set(MODULE_ID, "brushSize", this.brushSize);
  }

  /* -------------------------------------------- */
  /*  Commands invoked by toolbar buttons         */
  /* -------------------------------------------- */

  async commandClear() {
    if (!this._canPaint()) return;
    this.paintCanvas.clear();
    this._markTextureDirty(true);
    this._flagDirty();
    this.sync?.scheduleSave();
  }

  async commandUndo() {
    if (!this._canPaint()) return;
    if (this.paintCanvas.undo()) {
      this._markTextureDirty(true);
      this._flagDirty();
      this.sync?.scheduleSave();
    }
  }

  async commandRedo() {
    if (!this._canPaint()) return;
    if (this.paintCanvas.redo()) {
      this._markTextureDirty(true);
      this._flagDirty();
      this.sync?.scheduleSave();
    }
  }

  async commandSaveNow() {
    if (!this._canPaint()) return;
    await this.sync?.flushNow();
  }

  /* -------------------------------------------- */
  /*  Texture refresh (throttled ~30fps)          */
  /* -------------------------------------------- */

  _markTextureDirty(immediate) {
    if (!this.texture) return;
    if (immediate) {
      this.texture.source?.update?.();
      this.texture.update();
      return;
    }
    if (this._textureUpdateScheduled) return;
    this._textureUpdateScheduled = true;
    requestAnimationFrame(() => {
      this._textureUpdateScheduled = false;
      if (!this.texture) return;
      this.texture.source?.update?.();
      this.texture.update();
    });
  }

  /* -------------------------------------------- */
  /*  Helpers                                     */
  /* -------------------------------------------- */

  _canPaint() {
    return game.user?.isGM && !!this.paintCanvas;
  }

  _flagDirty() {
    this.isDirty = true;
  }
}

/* -------------------------------------------- */
/*  Utility: load an image URL to HTMLImage     */
/* -------------------------------------------- */

function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    // Bust browser cache for updated paint images.
    const sep = url.includes("?") ? "&" : "?";
    img.src = `${url}${sep}t=${Date.now()}`;
  });
}
