/**
 * PaintToolbar — Scene Controls integration for the paint layer.
 *
 * Foundry V13 passes `controls` to `getSceneControlButtons` as an object
 * keyed by control name. We register a new top-level control group
 * "paint" with tools for brush, eraser, fill, clear, undo, redo, and
 * save. Color and size pickers live in a lightweight DOM panel that is
 * shown while the paint layer is active.
 */

import { MODULE_ID } from "../paint-layer.js";

/* -------------------------------------------- */
/*  Top-level toolbar registration              */
/* -------------------------------------------- */

export function registerPaintToolbar(controls) {
  const isGM = game.user?.isGM;

  const tools = {
    brush: {
      name: "brush",
      title: "FVTT_PAINT_LAYER.Tools.Brush",
      icon: "fa-solid fa-paintbrush",
      visible: true,
      order: 1,
      onChange: () => setActiveTool("brush")
    },
    eraser: {
      name: "eraser",
      title: "FVTT_PAINT_LAYER.Tools.Eraser",
      icon: "fa-solid fa-eraser",
      visible: isGM,
      order: 2,
      onChange: () => setActiveTool("eraser")
    },
    fill: {
      name: "fill",
      title: "FVTT_PAINT_LAYER.Tools.Fill",
      icon: "fa-solid fa-fill-drip",
      visible: isGM,
      order: 3,
      onChange: () => setActiveTool("fill")
    },
    undo: {
      name: "undo",
      title: "FVTT_PAINT_LAYER.Tools.Undo",
      icon: "fa-solid fa-rotate-left",
      visible: isGM,
      button: true,
      order: 4,
      onChange: () => canvas.paint?.commandUndo()
    },
    redo: {
      name: "redo",
      title: "FVTT_PAINT_LAYER.Tools.Redo",
      icon: "fa-solid fa-rotate-right",
      visible: isGM,
      button: true,
      order: 5,
      onChange: () => canvas.paint?.commandRedo()
    },
    save: {
      name: "save",
      title: "FVTT_PAINT_LAYER.Tools.Save",
      icon: "fa-solid fa-floppy-disk",
      visible: isGM,
      button: true,
      order: 6,
      onChange: () => canvas.paint?.commandSaveNow()
    },
    clear: {
      name: "clear",
      title: "FVTT_PAINT_LAYER.Tools.Clear",
      icon: "fa-solid fa-trash",
      visible: isGM,
      button: true,
      order: 7,
      onChange: confirmAndClear
    }
  };

  const paintControl = {
    name: "paint",
    title: "FVTT_PAINT_LAYER.Controls.Title",
    icon: "fa-solid fa-palette",
    layer: "paint",
    activeTool: "brush",
    visible: isGM,
    order: 90,
    tools,
    onChange: (_event, active) => togglePaintPanel(active),
    onToolChange: (_event, tool) => setActiveTool(tool)
  };

  // V13: controls is a plain object keyed by name.
  controls.paint = paintControl;
}

/* -------------------------------------------- */
/*  Tool → layer wiring                         */
/* -------------------------------------------- */

function setActiveTool(toolName) {
  const layer = canvas?.paint;
  if (!layer) return;
  layer.setTool(toolName);
}

async function confirmAndClear() {
  const { DialogV2 } = foundry.applications.api;
  const confirmed = await DialogV2.confirm({
    window: { title: game.i18n.localize("FVTT_PAINT_LAYER.Dialog.ClearTitle") },
    content: `<p>${game.i18n.localize("FVTT_PAINT_LAYER.Dialog.ClearBody")}</p>`
  });
  if (confirmed) await canvas.paint?.commandClear();
}

/* -------------------------------------------- */
/*  Floating brush panel (color + size)         */
/* -------------------------------------------- */

const PANEL_ID = "fvtt-paint-layer-panel";

function togglePaintPanel(active) {
  const existing = document.getElementById(PANEL_ID);
  if (!active) {
    existing?.remove();
    return;
  }
  if (existing) return;

  const layer = canvas.paint;
  const currentColor = layer?.color ?? "#ff0000";
  const currentSize = layer?.brushSize ?? 8;

  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.className = "fvtt-paint-panel";
  panel.innerHTML = `
    <div class="fpl-row">
      <label for="fpl-color">${game.i18n.localize("FVTT_PAINT_LAYER.Panel.Color")}</label>
      <input id="fpl-color" type="color" value="${currentColor}" />
    </div>
    <div class="fpl-row">
      <label for="fpl-size">${game.i18n.localize("FVTT_PAINT_LAYER.Panel.Size")}</label>
      <input id="fpl-size" type="range" min="1" max="64" value="${currentSize}" />
      <span class="fpl-size-readout">${currentSize}</span>
    </div>
  `;
  document.body.appendChild(panel);

  const colorInput = panel.querySelector("#fpl-color");
  const sizeInput = panel.querySelector("#fpl-size");
  const sizeReadout = panel.querySelector(".fpl-size-readout");

  colorInput.addEventListener("input", (ev) => {
    canvas.paint?.setColor(ev.target.value);
  });
  sizeInput.addEventListener("input", (ev) => {
    const v = Number(ev.target.value);
    sizeReadout.textContent = v;
    canvas.paint?.setBrushSize(v);
  });
}

/* -------------------------------------------- */
/*  Hide the panel when the user switches away  */
/* -------------------------------------------- */

Hooks.on("renderSceneControls", (app) => {
  const active = app?.control?.name === "paint" || app?.activeControl === "paint";
  if (!active) {
    document.getElementById(PANEL_ID)?.remove();
  }
});
