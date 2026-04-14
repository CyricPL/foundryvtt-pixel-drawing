/**
 * PaintCanvas — offscreen 2D paint engine.
 *
 * Owns a single HTMLCanvasElement that is never added to the DOM. All
 * drawing uses the Canvas 2D API. The canvas is exposed as a PIXI
 * texture source by PaintLayer.
 */

const MAX_UNDO = 20;
const MAX_CANVAS_DIM = 4096;

export class PaintCanvas {
  /**
   * @param {number} width  Target scene width in pixels.
   * @param {number} height Target scene height in pixels.
   */
  constructor(width, height) {
    // Cap the backing canvas at MAX_CANVAS_DIM per side and record the
    // scale factor so PaintLayer can compensate in coordinate mapping.
    const scale = Math.min(
      1,
      MAX_CANVAS_DIM / Math.max(width, height)
    );
    this.scale = scale;
    this.width = Math.max(1, Math.round(width * scale));
    this.height = Math.max(1, Math.round(height * scale));

    this.canvas = document.createElement("canvas");
    this.canvas.width = this.width;
    this.canvas.height = this.height;

    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";

    // Stroke state
    this._stroking = false;
    this._lastX = 0;
    this._lastY = 0;
    this._strokeColor = "#ff0000";
    this._strokeSize = 8;
    this._strokeMode = "brush"; // "brush" | "eraser"

    // Undo/redo stacks
    this._undo = [];
    this._redo = [];
    this._pushUndo(); // initial empty state
  }

  /* -------------------------------------------- */
  /*  Scene→canvas coordinate helper              */
  /* -------------------------------------------- */

  toLocal(x, y) {
    return { x: x * this.scale, y: y * this.scale };
  }

  /* -------------------------------------------- */
  /*  Stroke API                                  */
  /* -------------------------------------------- */

  startStroke(x, y, { color, size, mode = "brush" } = {}) {
    this._commitRedoReset();
    this._pushUndo();

    this._strokeColor = color ?? this._strokeColor;
    this._strokeSize = size ?? this._strokeSize;
    this._strokeMode = mode;

    const p = this.toLocal(x, y);
    this._stroking = true;
    this._lastX = p.x;
    this._lastY = p.y;

    // Draw a single dot so a click with no drag still produces a mark.
    this._drawSegment(p.x, p.y, p.x, p.y);
  }

  continueStroke(x, y) {
    if (!this._stroking) return;
    const p = this.toLocal(x, y);
    this._drawSegment(this._lastX, this._lastY, p.x, p.y);
    this._lastX = p.x;
    this._lastY = p.y;
  }

  endStroke() {
    this._stroking = false;
  }

  _drawSegment(x0, y0, x1, y1) {
    const ctx = this.ctx;
    ctx.save();
    if (this._strokeMode === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = this._strokeColor;
    }
    ctx.lineWidth = this._strokeSize * this.scale;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
  }

  /* -------------------------------------------- */
  /*  Flood fill                                  */
  /* -------------------------------------------- */

  floodFill(x, y, color) {
    this._commitRedoReset();
    this._pushUndo();

    const p = this.toLocal(x, y);
    const px = Math.floor(p.x);
    const py = Math.floor(p.y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;

    const img = this.ctx.getImageData(0, 0, this.width, this.height);
    const data = img.data;
    const idx = (px + py * this.width) * 4;
    const target = [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
    const fill = PaintCanvas._parseColor(color);
    if (PaintCanvas._colorsEqual(target, fill)) return;

    const stack = [[px, py]];
    const W = this.width;
    const H = this.height;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
      const i = (cx + cy * W) * 4;
      if (
        data[i] !== target[0] ||
        data[i + 1] !== target[1] ||
        data[i + 2] !== target[2] ||
        data[i + 3] !== target[3]
      ) continue;

      data[i] = fill[0];
      data[i + 1] = fill[1];
      data[i + 2] = fill[2];
      data[i + 3] = fill[3];

      stack.push([cx + 1, cy]);
      stack.push([cx - 1, cy]);
      stack.push([cx, cy + 1]);
      stack.push([cx, cy - 1]);
    }
    this.ctx.putImageData(img, 0, 0);
  }

  /* -------------------------------------------- */
  /*  Erase (single spot, via eraser tool click)  */
  /* -------------------------------------------- */

  erase(x, y, size) {
    const p = this.toLocal(x, y);
    const r = (size ?? this._strokeSize) * this.scale;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(p.x, p.y, r / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* -------------------------------------------- */
  /*  Clear / Undo / Redo                         */
  /* -------------------------------------------- */

  clear() {
    this._commitRedoReset();
    this._pushUndo();
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  undo() {
    if (this._undo.length <= 1) return false;
    const current = this.ctx.getImageData(0, 0, this.width, this.height);
    this._redo.push(current);
    this._undo.pop(); // discard the snapshot we're about to restore into "past"
    const prev = this._undo[this._undo.length - 1];
    this.ctx.putImageData(prev, 0, 0);
    return true;
  }

  redo() {
    if (this._redo.length === 0) return false;
    const next = this._redo.pop();
    this.ctx.putImageData(next, 0, 0);
    this._undo.push(next);
    if (this._undo.length > MAX_UNDO) this._undo.shift();
    return true;
  }

  _pushUndo() {
    const snap = this.ctx.getImageData(0, 0, this.width, this.height);
    this._undo.push(snap);
    if (this._undo.length > MAX_UNDO) this._undo.shift();
  }

  _commitRedoReset() {
    // Any new edit invalidates the redo stack.
    this._redo.length = 0;
  }

  /* -------------------------------------------- */
  /*  Export                                      */
  /* -------------------------------------------- */

  toBlob(type = "image/png", quality) {
    return new Promise((resolve) => {
      this.canvas.toBlob((b) => resolve(b), type, quality);
    });
  }

  /**
   * Replace the canvas contents with an HTMLImageElement.
   */
  drawImage(image) {
    this._undo.length = 0;
    this._redo.length = 0;
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.drawImage(image, 0, 0, this.width, this.height);
    this._pushUndo();
  }

  /* -------------------------------------------- */
  /*  Color helpers                               */
  /* -------------------------------------------- */

  static _parseColor(c) {
    // Accepts "#rgb" / "#rrggbb" / "#rrggbbaa".
    if (typeof c !== "string") return [0, 0, 0, 255];
    let hex = c.trim();
    if (hex.startsWith("#")) hex = hex.slice(1);
    if (hex.length === 3) {
      hex = hex.split("").map((ch) => ch + ch).join("");
    }
    const r = parseInt(hex.slice(0, 2), 16) || 0;
    const g = parseInt(hex.slice(2, 4), 16) || 0;
    const b = parseInt(hex.slice(4, 6), 16) || 0;
    const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) : 255;
    return [r, g, b, a];
  }

  static _colorsEqual(a, b) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
  }
}
