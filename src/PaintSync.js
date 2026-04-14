/**
 * PaintSync — persists the offscreen paint canvas to the Foundry data
 * store and records the resulting URL on the scene flag.
 */

import { MODULE_ID } from "../paint-layer.js";

const UPLOAD_DIR = "paint-layer";

export class PaintSync {
  constructor(layer) {
    this.layer = layer;
    this._timer = null;
    this._uploadInFlight = null;
  }

  /* -------------------------------------------- */

  get delay() {
    return game.settings.get(MODULE_ID, "autoSaveDelay") ?? 2000;
  }

  /**
   * Debounced save — call on every stroke end / command.
   */
  scheduleSave() {
    if (!game.user?.isGM) return;
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._timer = null;
      this.flushNow().catch((err) => {
        console.error(`${MODULE_ID} | save failed`, err);
      });
    }, this.delay);
  }

  cancelPending() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  /**
   * Flush any pending save immediately.
   */
  async flushNow() {
    if (!game.user?.isGM) return;
    this.cancelPending();
    if (this._uploadInFlight) {
      // Chain after an in-flight upload to avoid racing the scene flag.
      await this._uploadInFlight.catch(() => {});
    }
    this._uploadInFlight = this._doSave();
    try {
      await this._uploadInFlight;
    } finally {
      this._uploadInFlight = null;
    }
  }

  /* -------------------------------------------- */

  async _doSave() {
    const layer = this.layer;
    if (!layer?.paintCanvas) return;
    const scene = canvas.scene;
    if (!scene) return;

    // 1) Convert offscreen canvas to a PNG blob.
    const blob = await layer.paintCanvas.toBlob("image/png");
    if (!blob) return;

    // 2) Ensure the upload directory exists.
    await ensureDirectory(UPLOAD_DIR);

    // 3) Upload.
    const filename = `paint-${scene.id}.png`;
    const file = new File([blob], filename, { type: "image/png" });

    let path;
    try {
      const res = await FilePicker.upload(
        "data",
        UPLOAD_DIR,
        file,
        {},
        { notify: false }
      );
      path = res?.path;
    } catch (err) {
      console.error(`${MODULE_ID} | upload failed`, err);
      return;
    }
    if (!path) return;

    // 4) Record on the scene flag. Suppress the reload echo on our own
    //    client — the local canvas already contains the latest pixels.
    layer._suppressNextFlagReload = true;
    await scene.setFlag(MODULE_ID, "paintImageUrl", path);
    layer.isDirty = false;
  }
}

/* -------------------------------------------- */
/*  Ensure a target directory exists            */
/* -------------------------------------------- */

async function ensureDirectory(path) {
  try {
    await FilePicker.browse("data", path);
  } catch (_err) {
    try {
      await FilePicker.createDirectory("data", path, {});
    } catch (err) {
      // Directory may already exist but not be browsable by a race;
      // swallow the error and let the upload surface any real issue.
      if (!`${err?.message ?? err}`.includes("EEXIST")) {
        console.warn(`${MODULE_ID} | createDirectory(${path})`, err);
      }
    }
  }
}
