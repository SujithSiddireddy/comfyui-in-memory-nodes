const { app } = window.comfyAPI.app;

// Drag-and-drop image + paint-mask widget for LoadImageInMemory.
// Everything happens client-side (FileReader + canvas); the resulting PNGs
// are base64-encoded straight into the node's hidden "image"/"mask" string
// widgets, so nothing is ever uploaded to input/ or input/clipspace/.

// Minimal line-style icons (stroke only, no fill) to match a clean, flat toolbar.
const ICON_SVG_OPEN = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
    upload: `<svg width="13" height="13" ${ICON_SVG_OPEN}><path d="M12 16V4M8 8l4-4 4 4"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>`,
    brush: `<svg width="15" height="15" ${ICON_SVG_OPEN}><path d="M18.4 2.6a2 2 0 0 1 3 3L12 15l-4 1 1-4z"/><path d="M8 16c-2.5 0-4 1.5-4 3.5 0 1-.5 1.5-1 2 3.5.5 7-.5 7-3.5"/></svg>`,
    bucket: `<svg width="15" height="15" ${ICON_SVG_OPEN}><path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11z"/><path d="m5 2 5 5"/><path d="M2 13h15"/><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4z"/></svg>`,
    invert: `<svg width="15" height="15" ${ICON_SVG_OPEN}><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>`,
    undo: `<svg width="15" height="15" ${ICON_SVG_OPEN}><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>`,
    redo: `<svg width="15" height="15" ${ICON_SVG_OPEN}><path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/></svg>`,
    reset: `<svg width="14" height="14" ${ICON_SVG_OPEN}><path d="M3 2v6h6"/><path d="M3 13a9 9 0 1 0 3-7.7L3 8"/></svg>`,
};

// Native range and color inputs can only be restyled through their pseudo-elements.
const inputStyle = document.createElement("style");
inputStyle.textContent = `
    .in-memory-slider { -webkit-appearance: none; appearance: none; height: 16px; margin: 0; background: transparent; cursor: pointer; }
    .in-memory-slider::-webkit-slider-runnable-track { height: 8px; border-radius: 4px; background: linear-gradient(to right, var(--p-primary-color, #4a7dfc) var(--fill, 0%), rgba(255,255,255,0.14) var(--fill, 0%)); }
    .in-memory-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; margin-top: -2px; border-radius: 50%; border: none; background: #f2f2f5; box-shadow: 0 0 0 1px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.4); }
    .in-memory-slider::-moz-range-track { height: 8px; border-radius: 4px; background: rgba(255,255,255,0.14); }
    .in-memory-slider::-moz-range-progress { height: 8px; border-radius: 4px; background: var(--p-primary-color, #4a7dfc); }
    .in-memory-slider::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; border: none; background: #f2f2f5; box-shadow: 0 0 0 1px rgba(0,0,0,0.35); }
`;
document.head.appendChild(inputStyle);

// Native title tooltips wait about a second; this one shows almost immediately.
const tooltip = document.createElement("div");
tooltip.style.cssText = `
    position:fixed;display:none;z-index:1000;pointer-events:none;padding:4px 8px;border-radius:6px;
    background:#0f0f12;color:#e8e8ec;font:500 11px/16px var(--comfy-font, Inter, "Segoe UI", Helvetica, Arial, sans-serif);
    border:1px solid rgba(255,255,255,0.12);box-shadow:0 4px 14px rgba(0,0,0,0.45);white-space:nowrap;
`;
document.body.appendChild(tooltip);
let tooltipTimer = 0;

function attachTooltip(el, text) {
    el.addEventListener("mouseenter", () => {
        clearTimeout(tooltipTimer);
        tooltipTimer = setTimeout(() => {
            tooltip.textContent = text;
            tooltip.style.display = "block";
            const right = el.dataset.tipSide === "right";
            const r = el.getBoundingClientRect();
            const t = tooltip.getBoundingClientRect();
            const left = right ? r.right + 8 : r.left + (r.width - t.width) / 2;
            const top = right ? r.top + (r.height - t.height) / 2 : r.bottom + 6;
            tooltip.style.left = `${Math.max(4, Math.min(left, window.innerWidth - t.width - 4))}px`;
            tooltip.style.top = `${Math.max(4, Math.min(top, window.innerHeight - t.height - 4))}px`;
        }, 150);
    });
    const hide = () => {
        clearTimeout(tooltipTimer);
        tooltip.style.display = "none";
    };
    el.addEventListener("mouseleave", hide);
    el.addEventListener("pointerdown", hide);
}

function hideWidget(widget) {
    if (!widget) return;
    widget.draw = () => {};
    widget.computeSize = () => [0, -4];
    widget.options = { ...(widget.options || {}), hidden: true };
}

function setup(node) {
    const imageWidget = node.widgets.find((w) => w.name === "image");
    const maskWidget = node.widgets.find((w) => w.name === "mask");
    hideWidget(imageWidget);
    hideWidget(maskWidget);

    const state = { img: null, w: 0, h: 0, brush: 32, hardness: 100, opacity: 55, maskColor: "#a10f0f", tool: "brush", maskOpen: false, previewMask: false, painting: false, bucket: false };

    const HISTORY_LIMIT = 10;
    const undoStack = [];
    const redoStack = [];

    const root = document.createElement("div");
    root.style.cssText = `
        display:flex;flex-direction:column;gap:6px;width:100%;height:100%;box-sizing:border-box;
        font-family:var(--comfy-font, Inter, "Segoe UI", Helvetica, Arial, sans-serif);
    `;

    // Only used as a starting suggestion the first time an image is dropped in,
    // and as the floor while the drop-zone is empty — after that the node
    // resizes completely freely, same as KJNodes' FastPreview node.
    const MIN_FRAME_H = 130;
    const FRAME_ASPECT = 0.75;

    const frame = document.createElement("div");
    frame.style.cssText = `
        position:relative;min-width:0;flex:1 1 0;
        border-radius:8px;overflow:hidden;
        background:var(--comfy-input-bg, #1a1a1e);
        border:1px solid var(--border-color, #3a3a40);
        box-sizing:border-box;
    `;

    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = Math.round(320 * FRAME_ASPECT);
    canvas.style.cssText = "width:100%;height:100%;display:block;cursor:default;touch-action:none;";

    const badge = document.createElement("div");
    badge.style.cssText = `
        position:absolute;top:6px;right:6px;padding:2px 7px;border-radius:5px;
        background:rgba(0,0,0,0.55);color:#ddd;font-size:10px;line-height:16px;
        font-variant-numeric:tabular-nums;pointer-events:none;opacity:0;transition:opacity .15s;
    `;

    const brushCursor = document.createElement("div");
    brushCursor.style.cssText = `
        position:absolute;top:0;left:0;border-radius:50%;pointer-events:none;
        border:1.5px solid rgba(255,255,255,0.85);box-shadow:0 0 0 1px rgba(0,0,0,0.6);
        transform:translate(-50%,-50%);display:none;
    `;

    frame.append(canvas, badge, brushCursor);

    const maskCanvas = document.createElement("canvas");
    const maskCtx = maskCanvas.getContext("2d");
    const ctx = canvas.getContext("2d");

    // --- toolbar -------------------------------------------------------
    // "image"/"mask" here are this node's actual IMAGE/MASK outputs (drawn by
    // LiteGraph itself, right after the title, connector dots on the right) —
    // not our hidden string widgets. That reserves a couple of native output
    // rows above where our DOM widget normally starts, leaving the left side of
    // those rows empty. Pull the "Mask the image" button up into that space
    // (negative margin) and cap its width so it never reaches the connectors;
    // the options panel sits below the connector rows at full width.
    const outputRowH = LiteGraph?.NODE_SLOT_HEIGHT ?? 20;
    const outputsH = (node.outputs?.length || 0) * outputRowH;
    const toolbar = document.createElement("div");
    toolbar.style.cssText = `
        display:grid;grid-template-columns:max-content;grid-auto-rows:${outputRowH + 2}px;align-items:end;
        flex:0 0 auto;max-width:calc(100% - 100px);
        margin-top:-${outputsH + 2}px;position:relative;z-index:1;
    `;

    function makeButton(text, title) {
        const btn = document.createElement("button");
        btn.innerHTML = text;
        attachTooltip(btn, title);
        btn.style.cssText = `
            display:flex;align-items:center;justify-content:center;flex:0 0 auto;white-space:nowrap;min-width:24px;height:24px;padding:0 10px;font-size:11px;
            background:transparent;color:#8a8a90;border:none;border-radius:5px;
            cursor:pointer;transition:background .12s,color .12s;
        `;
        btn.addEventListener("pointerdown", (e) => e.stopPropagation());
        btn.dataset.rest = "transparent";
        btn.addEventListener("mouseenter", () => {
            if (!btn.classList.contains("active")) btn.style.background = "rgba(255,255,255,0.1)";
        });
        btn.addEventListener("mouseleave", () => {
            if (!btn.classList.contains("active")) btn.style.background = btn.dataset.rest;
        });
        return btn;
    }

    function setActive(btn, active) {
        btn.classList.toggle("active", active);
        btn.style.background = active ? "rgba(74,125,252,0.38)" : btn.dataset.rest;
        btn.style.color = active ? "#b4c9ff" : "#8a8a90";
        btn.style.boxShadow = active ? "inset 0 0 0 1px rgba(110,155,255,0.65)" : "none";
    }

    const maskBtn = makeButton("Draw mask", "Show mask painting options");
    const previewMaskBtn = makeButton("Preview mask", "Show the mask as black and white beside the node");
    // One button per connector row, slightly smaller than the 24px buttons below.
    for (const btn of [maskBtn, previewMaskBtn]) {
        btn.style.height = "18px";
        btn.style.fontSize = "10px";
        btn.style.padding = "0 8px";
        btn.style.justifyContent = "flex-start";
        btn.dataset.rest = "rgba(255,255,255,0.06)";
        btn.style.background = btn.dataset.rest;
    }
    toolbar.append(maskBtn, previewMaskBtn);

    // Floating black/white mask window beside the node. It lives on document.body
    // (like the other DOM overlays) and is re-anchored to the node every frame
    // while enabled, so it follows graph pan, zoom and node dragging.
    const PREVIEW_W = 120;
    const maskWindow = document.createElement("canvas");
    maskWindow.style.cssText = `
        position:fixed;display:none;z-index:100;pointer-events:none;box-sizing:border-box;
        border:1px solid var(--border-color, #3a3a40);border-radius:6px;background:#000;
    `;
    document.body.appendChild(maskWindow);
    const maskWindowCtx = maskWindow.getContext("2d");

    function drawMaskWindow() {
        const aspect = state.w ? state.h / state.w : FRAME_ASPECT;
        maskWindow.width = PREVIEW_W;
        maskWindow.height = Math.round(PREVIEW_W * aspect);
        maskWindowCtx.imageSmoothingQuality = "high";
        maskWindowCtx.fillStyle = "#000";
        maskWindowCtx.fillRect(0, 0, maskWindow.width, maskWindow.height);
        if (state.w) maskWindowCtx.drawImage(maskCanvas, 0, 0, maskWindow.width, maskWindow.height);
    }

    let trackFrame = 0;
    function trackMaskWindow() {
        if (!state.previewMask || !node.graph) {
            maskWindow.style.display = "none";
            return;
        }
        const graphCanvas = app.canvas;
        if (node.graph === graphCanvas.graph && !node.flags?.collapsed) {
            const { scale, offset } = graphCanvas.ds;
            const rect = graphCanvas.canvas.getBoundingClientRect();
            maskWindow.style.left = `${rect.left + (node.pos[0] + node.size[0] + 10 + offset[0]) * scale}px`;
            const height = (maskWindow.height || 1) * scale;
            maskWindow.style.top = `${rect.top + (node.pos[1] + node.size[1] + offset[1]) * scale - height}px`;
            maskWindow.style.width = `${PREVIEW_W * scale}px`;
            maskWindow.style.height = `${height}px`;
            maskWindow.style.display = "block";
        } else {
            maskWindow.style.display = "none";
        }
        trackFrame = requestAnimationFrame(trackMaskWindow);
    }

    function setPreviewMask(on) {
        state.previewMask = on;
        setActive(previewMaskBtn, on);
        if (on) {
            drawMaskWindow();
            cancelAnimationFrame(trackFrame);
            trackMaskWindow();
        }
    }
    previewMaskBtn.addEventListener("click", (e) => {
        e.preventDefault();
        setPreviewMask(!state.previewMask);
    });

    const onRemoved = node.onRemoved;
    node.onRemoved = function () {
        state.previewMask = false;
        maskWindow.remove();
        colorInput.remove();
        return onRemoved?.apply(this, arguments);
    };

    // --- options panel (below the connector rows, full width) ------------
    // Label column + control column; every row shares the same column edges.
    const options = document.createElement("div");
    options.style.cssText = `
        display:none;grid-template-columns:64px minmax(0,1fr);align-items:center;
        gap:8px 10px;flex:0 0 auto;width:100%;box-sizing:border-box;
        border-top:1px solid var(--border-color, #3a3a40);padding:10px 0 2px;
    `;

    function makeLabel(text) {
        const label = document.createElement("span");
        label.textContent = text;
        label.style.cssText = "font-size:11px;color:#8a8a90;white-space:nowrap;";
        return label;
    }
    function makeCell() {
        const cell = document.createElement("div");
        cell.style.cssText = "display:flex;align-items:center;gap:8px;min-width:0;height:24px;";
        return cell;
    }
    function makeSlider(min, max, value) {
        const slider = document.createElement("input");
        slider.type = "range";
        slider.className = "in-memory-slider";
        slider.min = String(min);
        slider.max = String(max);
        slider.value = String(value);
        slider.style.cssText = "flex:1;width:100%;min-width:0;";
        const sync = () => slider.style.setProperty("--fill", `${((slider.value - min) / (max - min)) * 100}%`);
        sync();
        slider.addEventListener("input", sync);
        slider.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
            showBrushPreview();
        });
        slider.addEventListener("pointerup", hideBrushPreview);
        slider.addEventListener("blur", hideBrushPreview);
        return slider;
    }

    const brushBtn = makeButton("Paint", "Paint mask");
    const eraserBtn = makeButton("Erase", "Erase mask");
    const clearBtn = makeButton(ICONS.reset, "Reset mask");
    clearBtn.style.flex = "0 0 auto";
    setActive(brushBtn, true);

    // Paint / Erase as one segmented control.
    const segment = document.createElement("div");
    segment.style.cssText = "display:flex;flex:1;min-width:0;gap:2px;padding:2px;border-radius:7px;background:rgba(255,255,255,0.05);";
    segment.append(brushBtn, eraserBtn);
    for (const btn of [brushBtn, eraserBtn]) {
        btn.style.height = "20px";
        btn.style.flex = "1 1 0";
        btn.style.minWidth = "0";
    }

    // Paint/Erase stay selected while the bucket is active; the bucket only changes what a click does.
    function selectTool(tool, bucket = false) {
        state.tool = tool;
        state.bucket = bucket;
        setActive(brushBtn, tool === "brush");
        setActive(eraserBtn, tool === "eraser");
        setActive(railBrushBtn, !bucket);
        setActive(railFillBtn, bucket);
        brushCursor.style.display = "none";
    }
    brushBtn.addEventListener("click", (e) => {
        e.preventDefault();
        selectTool("brush");
    });
    eraserBtn.addEventListener("click", (e) => {
        e.preventDefault();
        selectTool("eraser");
    });
    clearBtn.addEventListener("click", (e) => {
        e.preventDefault();
        editMask(() => maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height));
    });

    const brushSlider = makeSlider(4, 150, state.brush);
    brushSlider.addEventListener("input", () => {
        state.brush = parseInt(brushSlider.value, 10);
        showBrushPreview();
    });

    const opacitySlider = makeSlider(5, 100, state.opacity);
    opacitySlider.addEventListener("input", () => {
        state.opacity = parseInt(opacitySlider.value, 10);
        brushPreview.style.opacity = state.opacity / 100;
        redraw();
        showBrushPreview();
    });

    const hardnessSlider = makeSlider(0, 100, state.hardness);
    hardnessSlider.addEventListener("input", () => {
        state.hardness = parseInt(hardnessSlider.value, 10);
        showBrushPreview();
    });

    // The native picker opens anchored to its input, so an invisible input is parked left of the tool rail
    // (instead of over the canvas) and opened from the swatch button.
    const colorBtn = makeButton('<span style="width:16px;height:16px;border-radius:5px;border:1px solid rgba(255,255,255,0.25);box-sizing:border-box;"></span>', "Mask color");
    const colorDot = colorBtn.firstChild;
    colorDot.style.background = state.maskColor;
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = state.maskColor;
    colorInput.style.cssText = "position:fixed;left:0;top:0;width:24px;height:24px;padding:0;border:none;opacity:0.01;pointer-events:none;";
    document.body.appendChild(colorInput);
    colorInput.addEventListener("input", () => {
        state.maskColor = colorInput.value;
        colorDot.style.background = colorInput.value;
        redraw();
        showBrushPreview();
    });
    colorBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const r = root.getBoundingClientRect();
        const b = colorBtn.getBoundingClientRect();
        colorInput.style.left = `${Math.max(4, r.left - 260)}px`;
        colorInput.style.top = `${Math.max(4, Math.min(b.top, window.innerHeight - 300))}px`;
        colorInput.offsetHeight; // flush layout so the picker anchors to the new position
        colorInput.showPicker();
    });

    const modeCell = makeCell();
    modeCell.append(segment, clearBtn);
    // Readout boxes share one width so both slider ends line up.
    function makeValueBox(slider, format) {
        const box = document.createElement("div");
        box.style.cssText = `
            flex:0 0 52px;box-sizing:border-box;height:20px;border-radius:5px;background:rgba(255,255,255,0.06);
            color:#c8c8ce;font-size:10px;line-height:20px;text-align:center;font-variant-numeric:tabular-nums;
        `;
        const sync = () => (box.textContent = format(slider.value));
        sync();
        slider.addEventListener("input", sync);
        return box;
    }
    const sizeCell = makeCell();
    sizeCell.append(brushSlider, makeValueBox(brushSlider, (v) => `${v} px`));
    const hardnessCell = makeCell();
    hardnessCell.append(hardnessSlider, makeValueBox(hardnessSlider, (v) => `${v} %`));
    const opacityCell = makeCell();
    opacityCell.append(opacitySlider, makeValueBox(opacitySlider, (v) => `${v} %`));
    options.append(makeLabel("Mode"), modeCell, makeLabel("Brush size"), sizeCell, makeLabel("Hardness"), hardnessCell, makeLabel("Opacity"), opacityCell);

    // Opening the panel grows the node by the panel's height (and closing shrinks
    // it back) so the canvas keeps the space it had.
    let optionsHeight = 0;
    let railHeight = 0;
    maskBtn.addEventListener("click", (e) => {
        e.preventDefault();
        state.maskOpen = !state.maskOpen;
        options.style.display = state.maskOpen ? "grid" : "none";
        rail.style.display = state.maskOpen ? "flex" : "none";
        setActive(maskBtn, state.maskOpen);
        canvas.style.cursor = state.maskOpen ? "crosshair" : "default";
        if (!state.maskOpen) brushCursor.style.display = "none";
        // A hidden panel measures 0, so remember the height it had when opened.
        if (state.maskOpen) {
            setPreviewMask(true);
            optionsHeight = options.offsetHeight + 6;
            railHeight = Array.from(rail.children).reduce((h, group) => h + group.offsetHeight, 6 * (rail.children.length - 1));
        }
        body.style.minHeight = state.maskOpen ? `${railHeight}px` : "0";
        const height = node.size[1] + (state.maskOpen ? optionsHeight : -optionsHeight);
        node.setSize([node.size[0], Math.max(height, TITLE_H + NODE_MARGIN + minWidgetHeight())]);
        node.graph?.setDirtyCanvas(true, true);
    });

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.style.display = "none";
    fileInput.addEventListener("change", () => {
        if (fileInput.files[0]) loadFile(fileInput.files[0]);
        fileInput.value = "";
    });

    // Tool rail left of the canvas: drawing tools, then whole-mask actions.
    const rail = document.createElement("div");
    rail.style.cssText = "display:none;flex:0 0 auto;flex-direction:column;gap:6px;";
    function railGroup(...buttons) {
        const group = document.createElement("div");
        group.style.cssText = "display:flex;flex-direction:column;gap:2px;padding:2px;border-radius:7px;background:rgba(255,255,255,0.05);";
        for (const btn of buttons) {
            btn.style.width = "26px";
            btn.style.height = "26px";
            btn.style.padding = "0";
            btn.dataset.tipSide = "right";
            group.append(btn);
        }
        return group;
    }
    const railBrushBtn = makeButton(ICONS.brush, "Brush");
    const railFillBtn = makeButton(ICONS.bucket, "Fill bucket");
    const invertBtn = makeButton(ICONS.invert, "Invert mask");
    const undoBtn = makeButton(ICONS.undo, "Undo");
    const redoBtn = makeButton(ICONS.redo, "Redo");
    undoBtn.addEventListener("click", (e) => {
        e.preventDefault();
        stepHistory(undoStack, redoStack);
    });
    redoBtn.addEventListener("click", (e) => {
        e.preventDefault();
        stepHistory(redoStack, undoStack);
    });
    updateHistoryButtons();
    setActive(railBrushBtn, true);
    railBrushBtn.addEventListener("click", (e) => {
        e.preventDefault();
        selectTool(state.tool);
    });
    railFillBtn.addEventListener("click", (e) => {
        e.preventDefault();
        selectTool(state.tool, true);
    });
    invertBtn.addEventListener("click", (e) => {
        e.preventDefault();
        editMask(() => {
            const img = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
            const px = img.data;
            for (let i = 0; i < px.length; i += 4) {
                px[i] = px[i + 1] = px[i + 2] = 255;
                px[i + 3] = 255 - px[i + 3];
            }
            maskCtx.putImageData(img, 0, 0);
        });
    });
    rail.append(railGroup(colorBtn), railGroup(railBrushBtn, railFillBtn), railGroup(invertBtn, undoBtn, redoBtn));

    const body = document.createElement("div");
    body.style.cssText = `display:flex;gap:6px;flex:1 1 auto;height:${MIN_FRAME_H}px;min-height:0;`;
    body.append(rail, frame);

    root.append(toolbar, options, body, fileInput);

    // Upload affordance lives inside the drop zone itself; only visible
    // while no image is loaded.
    const uploadOverlayBtn = document.createElement("button");
    uploadOverlayBtn.innerHTML = `${ICONS.upload}<span>Upload image</span>`;
    uploadOverlayBtn.style.cssText = `
        position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
        display:flex;align-items:center;gap:6px;padding:6px 12px;
        max-width:calc(100% - 20px);box-sizing:border-box;overflow:hidden;
        white-space:nowrap;text-overflow:ellipsis;
        background:var(--comfy-menu-bg, #2a2a2f);color:#9a9aa2;
        border:1px solid var(--border-color, #3a3a40);border-radius:6px;
        font-size:11px;cursor:pointer;transition:color .12s,border-color .12s;
    `;
    uploadOverlayBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    uploadOverlayBtn.addEventListener("mouseenter", () => {
        uploadOverlayBtn.style.color = "#e0e0e5";
        uploadOverlayBtn.style.borderColor = "var(--p-primary-color, #4a7dfc)";
    });
    uploadOverlayBtn.addEventListener("mouseleave", () => {
        uploadOverlayBtn.style.color = "#9a9aa2";
        uploadOverlayBtn.style.borderColor = "var(--border-color, #3a3a40)";
    });
    uploadOverlayBtn.addEventListener("click", (e) => {
        e.preventDefault();
        fileInput.click();
    });
    frame.appendChild(uploadOverlayBtn);

    // Center-canvas sample dab (size, hardness and color as painted) shown while a paint option is being adjusted.
    const brushPreview = document.createElement("canvas");
    brushPreview.style.cssText = `
        position:absolute;top:50%;left:50%;border-radius:50%;pointer-events:none;opacity:0.55;
        outline:1.5px dashed rgba(255,255,255,0.9);box-shadow:0 0 0 1px rgba(0,0,0,0.6);
        transform:translate(-50%,-50%);display:none;
    `;
    frame.appendChild(brushPreview);
    const brushPreviewLabel = document.createElement("div");
    brushPreviewLabel.style.cssText = `
        position:absolute;left:50%;transform:translateX(-50%);display:none;pointer-events:none;
        padding:2px 7px;border-radius:5px;background:rgba(0,0,0,0.65);color:#e6e6ea;
        font-size:10px;line-height:16px;white-space:nowrap;font-variant-numeric:tabular-nums;
    `;
    frame.appendChild(brushPreviewLabel);
    const previewCtx = brushPreview.getContext("2d");
    let brushPreviewTimer = null;
    function showBrushPreview() {
        clearTimeout(brushPreviewTimer);
        const size = state.brush;
        brushPreview.width = brushPreview.height = size;
        brushPreview.style.width = brushPreview.style.height = `${size}px`;
        const r = size / 2;
        stampDab(previewCtx, r, r, r);
        previewCtx.globalCompositeOperation = "source-in";
        previewCtx.fillStyle = state.tool === "eraser" ? "#ffffff" : state.maskColor;
        previewCtx.fillRect(0, 0, size, size);
        previewCtx.globalCompositeOperation = "source-over";
        brushPreview.style.display = "block";
        brushPreviewLabel.textContent = `${size} px · ${state.hardness}%`;
        brushPreviewLabel.style.top = `calc(50% + ${r + 8}px)`;
        brushPreviewLabel.style.display = "block";
        brushPreviewTimer = setTimeout(hideBrushPreview, 700);
    }
    function hideBrushPreview() {
        brushPreview.style.display = "none";
        brushPreviewLabel.style.display = "none";
    }

    // --- drawing ---------------------------------------------------------
    function tintedMaskOverlay() {
        const tmp = document.createElement("canvas");
        tmp.width = maskCanvas.width;
        tmp.height = maskCanvas.height;
        const tctx = tmp.getContext("2d");
        tctx.drawImage(maskCanvas, 0, 0);
        tctx.globalCompositeOperation = "source-in";
        tctx.fillStyle = state.maskColor;
        tctx.fillRect(0, 0, tmp.width, tmp.height);
        return tmp;
    }

    // The canvas buffer is sized in real device pixels (CSS size * devicePixelRatio)
    // to stay sharp on HiDPI/retina screens, but every draw call below works in
    // CSS-pixel units via this transform — otherwise a 1:1 buffer looks visibly
    // soft/pixelated on any display with a pixel ratio above 1.
    function redraw() {
        if (state.previewMask) drawMaskWindow();
        const cssW = canvas.clientWidth || canvas.width;
        const cssH = canvas.clientHeight || canvas.height;
        ctx.save();
        ctx.setTransform(canvas.width / cssW, 0, 0, canvas.height / cssH, 0, 0);
        ctx.clearRect(0, 0, cssW, cssH);

        if (!state.img) {
            uploadOverlayBtn.style.display = "flex";
            const g = ctx.createLinearGradient(0, 0, 0, cssH);
            g.addColorStop(0, "#232327");
            g.addColorStop(1, "#1a1a1e");
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, cssW, cssH);

            ctx.strokeStyle = "#3a3a40";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 5]);
            ctx.strokeRect(8, 8, cssW - 16, cssH - 16);
            ctx.setLineDash([]);

            ctx.fillStyle = "#6b6b72";
            ctx.font = "600 12px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("Drop image here", cssW / 2, cssH / 2 - 26);
            badge.style.opacity = "0";
            ctx.restore();
            return;
        }
        uploadOverlayBtn.style.display = "none";
        // "contain" fit: scale+center the image inside the frame (in CSS-pixel
        // units) instead of stretching it to fill, so its own aspect ratio is
        // preserved regardless of the frame's current shape.
        const scale = Math.min(cssW / state.w, cssH / state.h);
        const w = state.w * scale;
        const h = state.h * scale;
        const x = (cssW - w) / 2;
        const y = (cssH - h) / 2;
        state.containRect = { x, y, w, h };

        ctx.drawImage(state.img, x, y, w, h);
        ctx.globalAlpha = state.opacity / 100;
        ctx.drawImage(tintedMaskOverlay(), x, y, w, h);
        ctx.restore();
        badge.textContent = `${state.w}×${state.h}`;
        badge.style.opacity = "1";
    }

    // The frame fills whatever space the flex layout gives it (free resize,
    // like FastPreview). Whenever that box actually changes size, resync the
    // canvas buffer to match it (scaled by devicePixelRatio for crisp text/
    // lines on HiDPI screens) and redraw — otherwise the browser would stretch
    // the old buffer non-uniformly to fill the new box.
    const frameResizeObserver = new ResizeObserver(() => {
        const cssW = Math.max(1, Math.round(frame.clientWidth));
        const cssH = Math.max(1, Math.round(frame.clientHeight));
        const dpr = window.devicePixelRatio || 1;
        const bufW = Math.round(cssW * dpr);
        const bufH = Math.round(cssH * dpr);
        if (canvas.width === bufW && canvas.height === bufH) return;
        canvas.width = bufW;
        canvas.height = bufH;
        redraw();
    });
    frameResizeObserver.observe(frame);

    // One-time nudge to a pleasant 4:3 starting shape the first time an image
    // is dropped in. After that, resizing is entirely up to the user.
    let autoSized = false;
    function autoSizeOnce() {
        if (autoSized) return;
        autoSized = true;
        const w = node.size[0];
        const titleH = LiteGraph?.NODE_TITLE_HEIGHT ?? 30;
        const totalH = titleH + toolbar.offsetHeight + Math.round(w * FRAME_ASPECT) + 20;
        node.setSize([w, totalH]);
        node.graph?.setDirtyCanvas(true, true);
    }

    function updateHistoryButtons() {
        undoBtn.style.opacity = undoStack.length ? "1" : "0.35";
        redoBtn.style.opacity = redoStack.length ? "1" : "0.35";
    }

    function pushHistory() {
        undoStack.push(maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height));
        if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
        redoStack.length = 0;
        updateHistoryButtons();
    }

    function stepHistory(from, to) {
        if (!from.length) return;
        to.push(maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height));
        maskCtx.putImageData(from.pop(), 0, 0);
        updateHistoryButtons();
        redraw();
        commitMask();
    }

    function editMask(edit) {
        if (!state.w) return;
        pushHistory();
        edit();
        redraw();
        commitMask();
    }

    // Fills the empty region (alpha below half) connected to the clicked pixel, then climbs each soft edge up to its
    // core so no partially masked ring is left between the fill and the stroke.
    function floodFill(sx, sy) {
        const w = maskCanvas.width;
        const h = maskCanvas.height;
        const img = maskCtx.getImageData(0, 0, w, h);
        const px = img.data;
        const alpha = new Uint8Array(w * h);
        for (let k = 0; k < alpha.length; k++) alpha[k] = px[k * 4 + 3];
        const start = Math.floor(sy) * w + Math.floor(sx);
        if (alpha[start] >= 128) return;

        const filled = new Uint8Array(w * h);
        // Grows from a seed set over the neighbors accepted by `allow(neighbor, current)`.
        function grow(seeds, diagonal, allow) {
            const pending = seeds;
            while (pending.length) {
                const k = pending.pop();
                const col = k % w;
                const row = (k - col) / w;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if ((!dx && !dy) || (!diagonal && dx && dy)) continue;
                        if (col + dx < 0 || col + dx >= w || row + dy < 0 || row + dy >= h) continue;
                        const n = k + dy * w + dx;
                        if (!filled[n] && allow(n, k)) {
                            filled[n] = 1;
                            pending.push(n);
                        }
                    }
                }
            }
        }
        filled[start] = 1;
        grow([start], false, (n) => alpha[n] < 128);
        const edge = [];
        for (let k = 0; k < filled.length; k++) if (filled[k]) edge.push(k);
        // Equal values are allowed and diagonals count: at stroke corners the edge is flat along one axis.
        grow(edge, true, (n, k) => alpha[n] >= alpha[k] && alpha[n] < 255);
        for (let k = 0; k < filled.length; k++) {
            if (filled[k]) px[k * 4] = px[k * 4 + 1] = px[k * 4 + 2] = px[k * 4 + 3] = 255;
        }
        maskCtx.putImageData(img, 0, 0);
    }

    function commitMask() {
        maskWidget.value = state.w ? maskCanvas.toDataURL("image/png").split(",")[1] : "";
        node.graph?.setDirtyCanvas(true, true);
    }

    function loadFile(file) {
        if (!file || !file.type.startsWith("image/")) return;
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result;
            const img = new Image();
            img.onload = () => {
                state.img = img;
                state.w = img.naturalWidth;
                state.h = img.naturalHeight;
                maskCanvas.width = state.w;
                maskCanvas.height = state.h;
                maskCtx.clearRect(0, 0, state.w, state.h);
                undoStack.length = redoStack.length = 0;
                updateHistoryButtons();
                autoSizeOnce();
                redraw();
                imageWidget.value = dataUrl.split(",")[1];
                commitMask();
            };
            img.src = dataUrl;
        };
        reader.readAsDataURL(file);
    }

    // offsetX/offsetY are reported by the browser relative to the canvas's own
    // padding box, already in the same CSS-pixel space as containRect (both are
    // independent of the buffer's devicePixelRatio scaling) — so they stay
    // correct regardless of the graph's zoom/pan or HiDPI scaling, unlike the
    // getBoundingClientRect() math that was the original source of misalignment.
    // From there we map through containRect (the letterboxed image area) into
    // maskCanvas's native-resolution coordinate space.
    function toMaskCoords(e) {
        const rect = state.containRect;
        if (!rect) return null;
        const lx = e.offsetX - rect.x;
        const ly = e.offsetY - rect.y;
        if (lx < 0 || ly < 0 || lx > rect.w || ly > rect.h) return null; // over a letterbox bar
        const scaleX = maskCanvas.width / rect.w;
        const scaleY = maskCanvas.height / rect.h;
        return { x: lx * scaleX, y: ly * scaleY, scaleX, scaleY };
    }

    // A stroke's coverage is the brush falloff evaluated at each pixel's distance to the pointer path, keeping the
    // maximum seen so far, composited onto the mask as it was before the stroke. Stamping overlapping dabs would add
    // their alpha up and make a soft brush look far harder along a drag than in a single click.
    let stroke = null;

    function beginStroke() {
        const baseCanvas = document.createElement("canvas");
        baseCanvas.width = maskCanvas.width;
        baseCanvas.height = maskCanvas.height;
        const base = baseCanvas.getContext("2d", { willReadFrequently: true });
        base.drawImage(maskCanvas, 0, 0);
        stroke = { base, coverage: new Uint8ClampedArray(maskCanvas.width * maskCanvas.height), last: null };
    }

    function paintEvent(e) {
        if (!state.maskOpen) return;
        const coords = toMaskCoords(e);
        if (!coords) return;
        const { x, y, scaleX, scaleY } = coords;
        const r = (state.brush / 2) * ((scaleX + scaleY) / 2);
        // Even a fully hard brush keeps a 1px falloff so curves stay antialiased.
        const hard = Math.max(0, Math.min(state.hardness / 100, 1 - 1 / r));
        const from = stroke.last || { x, y };
        stroke.last = { x, y };

        const w = maskCanvas.width;
        const x0 = Math.max(0, Math.floor(Math.min(from.x, x) - r - 1));
        const y0 = Math.max(0, Math.floor(Math.min(from.y, y) - r - 1));
        const x1 = Math.min(w, Math.ceil(Math.max(from.x, x) + r + 1));
        const y1 = Math.min(maskCanvas.height, Math.ceil(Math.max(from.y, y) + r + 1));
        if (x1 <= x0 || y1 <= y0) return;

        const out = stroke.base.getImageData(x0, y0, x1 - x0, y1 - y0);
        const px = out.data;
        const dx = x - from.x;
        const dy = y - from.y;
        const len2 = dx * dx + dy * dy;
        const erase = state.tool === "eraser";
        for (let j = y0; j < y1; j++) {
            for (let i = x0; i < x1; i++) {
                const cx = i + 0.5 - from.x;
                const cy = j + 0.5 - from.y;
                const t = len2 ? Math.max(0, Math.min(1, (cx * dx + cy * dy) / len2)) : 0;
                const d = Math.hypot(cx - t * dx, cy - t * dy) / r;
                const k = j * w + i;
                if (d < 1) {
                    const a = d <= hard ? 255 : (255 * (1 - d)) / (1 - hard);
                    if (a > stroke.coverage[k]) stroke.coverage[k] = a;
                }
                const s = stroke.coverage[k] / 255;
                const o = ((j - y0) * (x1 - x0) + (i - x0)) * 4;
                px[o] = px[o + 1] = px[o + 2] = 255;
                px[o + 3] = erase ? px[o + 3] * (1 - s) : px[o + 3] + (255 - px[o + 3]) * s;
            }
        }
        maskCtx.putImageData(out, x0, y0);
        redraw();
    }

    // Single dab for the brush preview, same falloff as a stroke.
    function stampDab(c, x, y, r) {
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, "rgba(255,255,255,1)");
        g.addColorStop(Math.max(0, Math.min(state.hardness / 100, 1 - 1 / r)), "rgba(255,255,255,1)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        c.fillStyle = g;
        c.fillRect(x - r, y - r, r * 2, r * 2);
    }

    function updateBrushCursor(e) {
        if (!state.img || !state.maskOpen || state.bucket) {
            brushCursor.style.display = "none";
            return;
        }
        // state.brush is already in on-screen (CSS) pixels — the same units the
        // cursor is drawn in — so no scaling here. paintEvent() is what converts
        // it into mask-space pixels for the actual stroke.
        const displayR = state.brush / 2;
        brushCursor.style.display = "block";
        brushCursor.style.width = brushCursor.style.height = `${displayR * 2}px`;
        // canvas.offsetLeft/Top convert from canvas-local to frame-local coordinates
        // (both pre-transform), matching the space absolute positioning uses.
        brushCursor.style.left = `${e.offsetX + canvas.offsetLeft}px`;
        brushCursor.style.top = `${e.offsetY + canvas.offsetTop}px`;
        brushCursor.style.borderColor = state.tool === "eraser" ? "rgba(255,120,120,0.9)" : "rgba(255,255,255,0.85)";
    }

    canvas.addEventListener("pointerdown", (e) => {
        if (!state.img || !state.maskOpen) return;
        if (state.bucket) {
            const coords = toMaskCoords(e);
            if (coords) editMask(() => floodFill(coords.x, coords.y));
            return;
        }
        state.painting = true;
        pushHistory();
        beginStroke();
        canvas.setPointerCapture(e.pointerId);
        paintEvent(e);
        updateBrushCursor(e);
    });
    canvas.addEventListener("pointermove", (e) => {
        updateBrushCursor(e);
        if (!state.painting) return;
        paintEvent(e);
    });
    canvas.addEventListener("pointerup", () => {
        if (!state.painting) return;
        state.painting = false;
        stroke = null;
        commitMask();
    });
    canvas.addEventListener("pointerleave", () => {
        brushCursor.style.display = "none";
    });
    canvas.addEventListener("dblclick", () => fileInput.click());

    // DOM widgets are overlaid on top of ComfyUI's actual graph <canvas>, so
    // wheel/pinch events over our widget never reach it, and the browser falls
    // back to zooming the whole page. Forward the event onto the graph canvas
    // instead, so LiteGraph zooms the graph exactly like it does everywhere else.
    root.addEventListener(
        "wheel",
        (e) => {
            e.preventDefault();
            const graphCanvas = document.getElementById("graph-canvas");
            if (!graphCanvas) return;
            graphCanvas.dispatchEvent(
                new WheelEvent("wheel", {
                    deltaX: e.deltaX,
                    deltaY: e.deltaY,
                    deltaMode: e.deltaMode,
                    clientX: e.clientX,
                    clientY: e.clientY,
                    ctrlKey: e.ctrlKey,
                    bubbles: true,
                    cancelable: true,
                })
            );
        },
        { passive: false }
    );
    // Safari's trackpad-pinch gesture events have no LiteGraph equivalent to
    // forward to; just stop them from triggering native page zoom.
    root.addEventListener("gesturestart", (e) => e.preventDefault());
    root.addEventListener("gesturechange", (e) => e.preventDefault());
    root.addEventListener("gestureend", (e) => e.preventDefault());

    frame.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        frame.style.borderColor = "var(--p-primary-color, #4a7dfc)";
        frame.style.boxShadow = "0 0 0 1px var(--p-primary-color, #4a7dfc)";
    });
    frame.addEventListener("dragleave", (e) => {
        if (frame.contains(e.relatedTarget)) return;
        frame.style.borderColor = "var(--border-color, #3a3a40)";
        frame.style.boxShadow = "none";
    });
    frame.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        frame.style.borderColor = "var(--border-color, #3a3a40)";
        frame.style.boxShadow = "none";
        const file = e.dataTransfer?.files?.[0];
        if (file) loadFile(file);
    });

    // Restore from a saved workflow (widget values already deserialized by now).
    if (imageWidget.value) {
        const img = new Image();
        img.onload = () => {
            state.img = img;
            state.w = img.naturalWidth;
            state.h = img.naturalHeight;
            maskCanvas.width = state.w;
            maskCanvas.height = state.h;
            // A restored node already has its saved size — never auto-size it.
            autoSized = true;
            if (maskWidget.value) {
                const m = new Image();
                m.onload = () => {
                    maskCtx.drawImage(m, 0, 0);
                    redraw();
                };
                m.src = "data:image/png;base64," + maskWidget.value;
            } else {
                redraw();
            }
        };
        img.src = "data:image/png;base64," + imageWidget.value;
    } else {
        redraw();
    }

    // Free resize, same idea as FastPreview: the widget's height tracks
    // whatever total node height the user drags to (node.size[1] minus title
    // and margins), clamped only by a floor — smaller while the drop-zone is
    // empty (it needs to stay usable) and even smaller once an image is
    // loaded, with no ceiling.
    const TITLE_H = LiteGraph?.NODE_TITLE_HEIGHT ?? 30;
    const NODE_MARGIN = 10;
    function minWidgetHeight() {
        const frameH = Math.max(state.img ? 90 : MIN_FRAME_H, state.maskOpen ? railHeight : 0);
        return frameH + toolbar.offsetHeight + (state.maskOpen ? options.offsetHeight + 6 : 0);
    }
    const domWidget = node.addDOMWidget("load_image_mask_base64_ui", "load_image_mask_base64_ui", root, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => minWidgetHeight(),
        getMaxHeight: () => 8000,
        getHeight: () => Math.max(minWidgetHeight(), node.size[1] - TITLE_H - NODE_MARGIN),
    });
    node.resizable = true;

    // Line the button rows up with the connector rows: LiteGraph knows where the
    // first output slot is drawn and where this widget starts, so offset by the difference.
    const onDrawForeground = node.onDrawForeground;
    node.onDrawForeground = function () {
        onDrawForeground?.apply(this, arguments);
        if (domWidget.y == null || !node.outputs?.length) return;
        const slotY = node.getConnectionPos(false, 0)[1] - node.pos[1];
        const margin = Math.round(slotY - outputRowH / 2 - domWidget.y) - 12;
        toolbar.style.marginTop = `${margin}px`;
    };

    // Narrowest width at which the Paint/Erase/reset row still fits beside the output slots.
    const MIN_NODE_W = 200;
    const onResize = node.onResize;
    node.onResize = function (size) {
        size[0] = Math.max(size[0], MIN_NODE_W);
        return onResize?.apply(this, arguments);
    };
    if (node.size[0] < MIN_NODE_W) node.setSize([MIN_NODE_W, node.size[1]]);
}

app.registerExtension({
    name: "comfyui-load-image-mask-base64",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "LoadImageInMemory") return;
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            setup(this);
        };
    },
});
