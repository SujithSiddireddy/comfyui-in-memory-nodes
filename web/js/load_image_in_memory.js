const { app } = window.comfyAPI.app;

// Drag-and-drop image + paint-mask widget for LoadImageInMemory.
// Everything happens client-side (FileReader + canvas); the resulting PNGs
// are base64-encoded straight into the node's hidden "image"/"mask" string
// widgets, so nothing is ever uploaded to input/ or input/clipspace/.

// Minimal line-style icons (stroke only, no fill) to match a clean, flat toolbar.
const ICON_SVG_OPEN = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
    upload: `<svg width="13" height="13" ${ICON_SVG_OPEN}><path d="M12 16V4M8 8l4-4 4 4"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>`,
    brush: `<svg width="14" height="14" ${ICON_SVG_OPEN}><path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.07"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02Z"/></svg>`,
    eraser: `<svg width="14" height="14" ${ICON_SVG_OPEN}><path d="m7 21-4.3-4.3a2 2 0 0 1 0-2.8l9.6-9.6a2 2 0 0 1 2.8 0l5.7 5.7a2 2 0 0 1 0 2.8L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>`,
    reset: `<svg width="14" height="14" ${ICON_SVG_OPEN}><path d="M3 2v6h6"/><path d="M3 13a9 9 0 1 0 3-7.7L3 8"/></svg>`,
};

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

    const state = { img: null, w: 0, h: 0, brush: 32, tool: "brush", painting: false, hover: null };

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
        position:relative;width:100%;height:${MIN_FRAME_H}px;min-height:0;flex:1 1 auto;
        border-radius:8px;overflow:hidden;
        background:var(--comfy-input-bg, #1a1a1e);
        border:1px solid var(--border-color, #3a3a40);
        box-sizing:border-box;
    `;

    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = Math.round(320 * FRAME_ASPECT);
    canvas.style.cssText = "width:100%;height:100%;display:block;cursor:crosshair;touch-action:none;";

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
    const toolbar = document.createElement("div");
    // "image"/"mask" here are this node's actual IMAGE/MASK outputs (drawn by
    // LiteGraph itself, right after the title, connector dots on the right) —
    // not our hidden string widgets. That reserves a couple of native output
    // rows above where our DOM widget normally starts, leaving the left side of
    // those rows empty. Pull the toolbar up into that space (negative margin);
    // only toolRow (the icon buttons) shares that vertical band with the output
    // dots/labels so only it gets width-capped — the brush-size row sits below
    // and can stay full width.
    const outputRowH = LiteGraph?.NODE_SLOT_HEIGHT ?? 20;
    const outputsH = (node.outputs?.length || 0) * outputRowH;
    toolbar.style.cssText = `
        display:flex;flex-direction:column;gap:6px;flex:0 0 auto;
        margin-top:-${outputsH}px;position:relative;z-index:1;
    `;

    const toolRow = document.createElement("div");
    toolRow.style.cssText = "display:flex;align-items:center;gap:6px;max-width:calc(100% - 130px);";

    function makeIconButton(icon, title) {
        const btn = document.createElement("button");
        btn.innerHTML = icon;
        btn.title = title;
        btn.style.cssText = `
            display:flex;align-items:center;justify-content:center;width:24px;height:24px;
            background:transparent;color:#8a8a90;border:none;border-radius:5px;
            cursor:pointer;transition:background .12s,color .12s;
        `;
        btn.addEventListener("pointerdown", (e) => e.stopPropagation());
        btn.addEventListener("mouseenter", () => {
            if (!btn.classList.contains("active")) btn.style.background = "rgba(255,255,255,0.07)";
        });
        btn.addEventListener("mouseleave", () => {
            if (!btn.classList.contains("active")) btn.style.background = "transparent";
        });
        return btn;
    }

    function setActive(btn, active) {
        btn.classList.toggle("active", active);
        btn.style.background = active ? "rgba(74,125,252,0.16)" : "transparent";
        btn.style.color = active ? "var(--p-primary-color, #4a7dfc)" : "#8a8a90";
    }

    const brushBtn = makeIconButton(ICONS.brush, "Paint mask");
    const eraserBtn = makeIconButton(ICONS.eraser, "Erase mask");
    const clearBtn = makeIconButton(ICONS.reset, "Reset mask");
    setActive(brushBtn, true);

    // Clicking the already-active tool deselects it — neither has to be active.
    function selectTool(tool) {
        state.tool = state.tool === tool ? null : tool;
        setActive(brushBtn, state.tool === "brush");
        setActive(eraserBtn, state.tool === "eraser");
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
        if (!state.w) return;
        maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        redraw();
        commitMask();
    });

    const brushLabel = document.createElement("span");
    brushLabel.textContent = "Brush size";
    brushLabel.style.cssText = "font-size:10px;color:#888;white-space:nowrap;";

    const brushRow = document.createElement("div");
    brushRow.style.cssText = "display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;";

    const brushSlider = document.createElement("input");
    brushSlider.type = "range";
    brushSlider.min = "4";
    brushSlider.max = "150";
    brushSlider.value = String(state.brush);
    brushSlider.style.cssText = "flex:1;width:100%;accent-color:var(--p-primary-color, #4a7dfc);min-width:0;";
    brushSlider.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        showBrushPreview();
    });
    brushSlider.addEventListener("input", () => {
        state.brush = parseInt(brushSlider.value, 10);
        showBrushPreview();
    });
    brushSlider.addEventListener("pointerup", hideBrushPreview);
    brushSlider.addEventListener("blur", hideBrushPreview);

    brushRow.append(brushLabel, brushSlider);

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.style.display = "none";
    fileInput.addEventListener("change", () => {
        if (fileInput.files[0]) loadFile(fileInput.files[0]);
        fileInput.value = "";
    });

    toolRow.append(brushBtn, eraserBtn, clearBtn, fileInput);
    toolbar.append(toolRow, brushRow);
    root.append(toolbar, frame);

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

    // Center-canvas preview ring shown while the brush-size slider is being dragged.
    const brushPreview = document.createElement("div");
    brushPreview.style.cssText = `
        position:absolute;top:50%;left:50%;border-radius:50%;pointer-events:none;
        border:1.5px dashed rgba(255,255,255,0.9);box-shadow:0 0 0 1px rgba(0,0,0,0.6);
        transform:translate(-50%,-50%);display:none;
    `;
    frame.appendChild(brushPreview);
    let brushPreviewTimer = null;
    function showBrushPreview() {
        clearTimeout(brushPreviewTimer);
        brushPreview.style.width = brushPreview.style.height = `${state.brush}px`;
        brushPreview.style.display = "block";
        brushPreviewTimer = setTimeout(hideBrushPreview, 700);
    }
    function hideBrushPreview() {
        brushPreview.style.display = "none";
    }

    // --- drawing ---------------------------------------------------------
    function tintedMaskOverlay() {
        const tmp = document.createElement("canvas");
        tmp.width = maskCanvas.width;
        tmp.height = maskCanvas.height;
        const tctx = tmp.getContext("2d");
        tctx.drawImage(maskCanvas, 0, 0);
        tctx.globalCompositeOperation = "source-in";
        tctx.fillStyle = "#a10f0f";
        tctx.fillRect(0, 0, tmp.width, tmp.height);
        return tmp;
    }

    // The canvas buffer is sized in real device pixels (CSS size * devicePixelRatio)
    // to stay sharp on HiDPI/retina screens, but every draw call below works in
    // CSS-pixel units via this transform — otherwise a 1:1 buffer looks visibly
    // soft/pixelated on any display with a pixel ratio above 1.
    function redraw() {
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
        ctx.globalAlpha = 0.55;
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

    function paintEvent(e) {
        if (!state.tool) return; // both brush and eraser deselected — nothing to do
        const coords = toMaskCoords(e);
        if (!coords) return;
        const { x, y, scaleX, scaleY } = coords;
        const r = (state.brush / 2) * ((scaleX + scaleY) / 2);
        maskCtx.globalCompositeOperation = state.tool === "eraser" ? "destination-out" : "source-over";
        maskCtx.fillStyle = "#fff";
        maskCtx.beginPath();
        maskCtx.arc(x, y, r, 0, Math.PI * 2);
        maskCtx.fill();
        redraw();
    }

    function updateBrushCursor(e) {
        if (!state.img || !state.tool) {
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
        if (!state.img) return;
        state.painting = true;
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

    canvas.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        frame.style.borderColor = "var(--p-primary-color, #4a7dfc)";
        frame.style.boxShadow = "0 0 0 1px var(--p-primary-color, #4a7dfc)";
    });
    canvas.addEventListener("dragleave", () => {
        frame.style.borderColor = "var(--border-color, #3a3a40)";
        frame.style.boxShadow = "none";
    });
    canvas.addEventListener("drop", (e) => {
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
        return (state.img ? 90 : MIN_FRAME_H) + toolbar.offsetHeight;
    }
    node.addDOMWidget("load_image_mask_base64_ui", "load_image_mask_base64_ui", root, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => minWidgetHeight(),
        getMaxHeight: () => 8000,
        getHeight: () => Math.max(minWidgetHeight(), node.size[1] - TITLE_H - NODE_MARGIN),
    });
    node.resizable = true;
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
