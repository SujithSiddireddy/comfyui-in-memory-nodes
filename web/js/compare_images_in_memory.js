const { app } = window.comfyAPI.app;
import { forwardCanvasEvents, ignoreWidgetWidth } from "./forward_canvas_events.js";

// Slider comparison for CompareImagesInMemory. Both batches arrive as base64
// PNGs in the execution result; nothing is read from or written to disk.

const FONT = 'var(--comfy-font, Inter, "Segoe UI", Helvetica, Arial, sans-serif)';
const MIN_NODE_W = 200;
const MIN_FRAME_H = 130;
const TITLE_H = LiteGraph?.NODE_TITLE_HEIGHT ?? 30;
const NODE_MARGIN = 10;
// Nodes 2.0 lays slot rows out in HTML, and node.onDrawForeground is never called there, so the
// toolbar uses this fixed top margin (px) instead of the per-frame alignment.
const VUE_TOOLBAR_MARGIN_TOP = -46;

const DOWNLOAD_ICON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12M8 12l4 4 4-4"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>';

function download(b64, name) {
    const a = document.createElement("a");
    a.href = "data:image/png;base64," + b64;
    a.download = name;
    a.click();
}

function setup(node) {
    let pairs = [];
    let index = 0;
    let split = 50;

    const root = document.createElement("div");
    root.style.cssText = `display:flex;flex-direction:column;gap:6px;width:100%;height:100%;box-sizing:border-box;font-family:${FONT};`;

    // Same layout as Load Image's toolbar: one small button per connector row, pulled up into the
    // empty space beside the native slots (here the inputs, so the buttons sit on the right).
    const rowH = LiteGraph?.NODE_SLOT_HEIGHT ?? 20;
    const slotsH = (node.inputs?.length || 0) * rowH;
    const toolbar = document.createElement("div");
    toolbar.style.cssText = `
        display:grid;grid-template-columns:max-content;grid-auto-rows:${rowH + 2}px;align-items:end;justify-content:end;
        flex:0 0 auto;max-width:calc(100% - 100px);align-self:flex-end;
        margin-top:-${slotsH + 2}px;position:relative;z-index:1;
    `;
    function toolbarButton(side) {
        const btn = document.createElement("button");
        btn.innerHTML = `${DOWNLOAD_ICON}<span>Download ${side.toUpperCase()}</span>`;
        btn.title = `Download image ${side.toUpperCase()}`;
        btn.style.cssText = `
            display:flex;align-items:center;justify-content:flex-start;gap:5px;white-space:nowrap;height:18px;padding:0 8px;
            font:500 10px ${FONT};background:rgba(255,255,255,0.06);color:#8a8a90;border:none;border-radius:5px;
            cursor:pointer;transition:background .12s,color .12s;
        `;
        btn.addEventListener("pointerdown", (e) => e.stopPropagation());
        btn.addEventListener("mouseenter", () => (btn.style.background = "rgba(255,255,255,0.1)"));
        btn.addEventListener("mouseleave", () => (btn.style.background = "rgba(255,255,255,0.06)"));
        btn.addEventListener("click", () => {
            if (pairs.length) download(pairs[index][side], `compare_${side}_${String(index + 1).padStart(5, "0")}.png`);
        });
        return btn;
    }
    toolbar.append(toolbarButton("a"), toolbarButton("b"));
    // Read per layout pass, since Nodes 2.0 can be toggled while the node is on the canvas.
    function applyVueMargin() {
        if (LiteGraph.vueNodesMode) toolbar.style.marginTop = `${VUE_TOOLBAR_MARGIN_TOP}px`;
    }

    const frame = document.createElement("div");
    frame.style.cssText = `
        position:relative;min-width:0;flex:1 1 0;border-radius:8px;overflow:hidden;cursor:ew-resize;touch-action:none;
        background:var(--comfy-input-bg, #1a1a1e);border:1px solid var(--border-color, #3a3a40);box-sizing:border-box;
    `;

    const imgStyle = "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:none;pointer-events:none;";
    const imgB = document.createElement("img");
    const imgA = document.createElement("img");
    imgB.style.cssText = imgA.style.cssText = imgStyle;

    const line = document.createElement("div");
    line.style.cssText = "position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;background:rgba(255,255,255,0.85);box-shadow:0 0 0 1px rgba(0,0,0,0.5);pointer-events:none;display:none;";

    function tag(text, side) {
        const t = document.createElement("div");
        t.textContent = text;
        t.style.cssText = `position:absolute;top:6px;${side}:6px;padding:2px 7px;border-radius:5px;background:rgba(0,0,0,0.55);color:#ddd;font-size:10px;line-height:16px;pointer-events:none;display:none;`;
        return t;
    }
    const tagA = tag("A", "left");
    const tagB = tag("B", "right");

    const empty = document.createElement("div");
    empty.textContent = "Run the workflow to compare";
    empty.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:#8a8a92;pointer-events:none;";

    frame.append(imgB, imgA, line, tagA, tagB, empty);

    function setSplit(x) {
        split = Math.min(100, Math.max(0, x));
        imgA.style.clipPath = `inset(0 ${100 - split}% 0 0)`;
        line.style.left = `${split}%`;
    }
    frame.addEventListener("pointermove", (e) => {
        const r = frame.getBoundingClientRect();
        setSplit(((e.clientX - r.left) / r.width) * 100);
    });
    setSplit(50);

    const bar = document.createElement("div");
    bar.style.cssText = "display:none;gap:6px;align-items:center;";
    function button(text) {
        const b = document.createElement("button");
        b.textContent = text;
        b.style.cssText = `
            display:inline-flex;align-items:center;justify-content:center;height:24px;padding:0 9px;
            border-radius:6px;border:1px solid var(--border-color, #3a3a40);background:var(--comfy-input-bg, #1a1a1e);
            color:var(--input-text, #ddd);font:500 11px ${FONT};cursor:pointer;
        `;
        return b;
    }
    const prev = button("‹");
    const next = button("›");
    const counter = document.createElement("span");
    counter.style.cssText = "font-size:11px;color:#8a8a92;font-variant-numeric:tabular-nums;";
    const size = document.createElement("span");
    size.style.cssText = "flex:1 1 0;text-align:right;font-size:11px;color:#8a8a92;font-variant-numeric:tabular-nums;white-space:nowrap;";
    bar.append(prev, counter, next, size);

    function show(i) {
        index = (i + pairs.length) % pairs.length;
        imgA.src = "data:image/png;base64," + pairs[index].a;
        imgB.src = "data:image/png;base64," + pairs[index].b;
        counter.textContent = `${index + 1} / ${pairs.length}`;
        prev.style.display = next.style.display = counter.style.display = pairs.length > 1 ? "" : "none";
    }
    prev.addEventListener("click", () => show(index - 1));
    next.addEventListener("click", () => show(index + 1));
    const updateSize = () => (size.textContent = `A ${imgA.naturalWidth} × ${imgA.naturalHeight}  ·  B ${imgB.naturalWidth} × ${imgB.naturalHeight}`);
    imgA.addEventListener("load", updateSize);
    imgB.addEventListener("load", updateSize);

    root.append(toolbar, frame, bar);
    forwardCanvasEvents(root);

    const domWidget = node.addDOMWidget("in_memory_compare_ui", "in_memory_compare_ui", root, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => (applyVueMargin(), MIN_FRAME_H + bar.offsetHeight + toolbar.offsetHeight),
        getMaxHeight: () => 8000,
        getHeight: () => Math.max(MIN_FRAME_H + bar.offsetHeight + toolbar.offsetHeight, node.size[1] - TITLE_H - NODE_MARGIN),
    });

    ignoreWidgetWidth(domWidget);

    node.onExecuted = function (message) {
        const a = message?.compare_a ?? [];
        const b = message?.compare_b ?? [];
        // A shorter batch is repeated so every image of the longer one has a partner.
        pairs = Array.from({ length: a.length && b.length ? Math.max(a.length, b.length) : 0 }, (_, i) => ({ a: a[i % a.length], b: b[i % b.length] }));
        const has = pairs.length > 0;
        for (const el of [imgA, imgB]) el.style.display = has ? "block" : "none";
        for (const el of [line, tagA, tagB]) el.style.display = has ? "block" : "none";
        empty.style.display = has ? "none" : "flex";
        bar.style.display = has ? "flex" : "none";
        if (has) show(0);
    };

    // Line the buttons up with the input rows: offset by the gap between the first slot and this widget.
    const onDrawForeground = node.onDrawForeground;
    node.onDrawForeground = function () {
        onDrawForeground?.apply(this, arguments);
        if (LiteGraph.vueNodesMode || domWidget.y == null || !node.inputs?.length) return;
        const slotY = node.getConnectionPos(true, 0)[1] - node.pos[1];
        toolbar.style.marginTop = `${Math.round(slotY - rowH / 2 - domWidget.y) - 12}px`;
    };

    node.resizable = true;
    const onResize = node.onResize;
    node.onResize = function (s) {
        s[0] = Math.max(s[0], MIN_NODE_W);
        return onResize?.apply(this, arguments);
    };
    if (node.size[0] < MIN_NODE_W) node.setSize([MIN_NODE_W, Math.max(node.size[1], 300)]);
}

app.registerExtension({
    name: "comfyui-compare-images-in-memory",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "CompareImagesInMemory") return;
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            setup(this);
        };
    },
});
