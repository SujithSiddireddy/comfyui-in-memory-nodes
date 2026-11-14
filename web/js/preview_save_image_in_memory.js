const { app } = window.comfyAPI.app;
import { forwardCanvasEvents, ignoreWidgetWidth } from "./forward_canvas_events.js";

// Renders the base64 PNGs that PreviewImageInMemory / SaveImageInMemory return
// in their execution result. Nothing touches the server's temp/ or output/;
// Save downloads straight from the browser.

const FONT = 'var(--comfy-font, Inter, "Segoe UI", Helvetica, Arial, sans-serif)';
const DOWNLOAD_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12M8 12l4 4 4-4"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>';
const MIN_NODE_W = 200;
const MIN_FRAME_H = 130;
const TITLE_H = LiteGraph?.NODE_TITLE_HEIGHT ?? 30;
const NODE_MARGIN = 10;

const FOLDER_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

// The chosen folder handle is shared by all Save nodes and remembered across sessions.
function idb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open("comfyui-in-memory-nodes", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("handles");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbRun(mode, fn) {
    const db = await idb();
    return new Promise((resolve, reject) => {
        const req = fn(db.transaction("handles", mode).objectStore("handles"));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

const loadDirHandle = () => idbRun("readonly", (st) => st.get("dir")).catch(() => undefined);
const storeDirHandle = (handle) => idbRun("readwrite", (st) => (handle ? st.put(handle, "dir") : st.delete("dir")));

async function canWrite(handle, canPrompt) {
    const opts = { mode: "readwrite" };
    if ((await handle.queryPermission(opts)) === "granted") return true;
    // Re-granting needs a user gesture, so it is only attempted from a button click.
    return canPrompt && (await handle.requestPermission(opts)) === "granted";
}

// "a/b/name" puts the files into subfolders a/b of the chosen folder.
async function writeToFolder(root, prefix, images) {
    const parts = prefix.split(/[\\/]/).filter((p) => p && p !== "." && p !== "..");
    const base = parts.pop() || "ComfyUI";
    let dir = root;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
    let counter = 0;
    const pattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_(\\d+)\\.png$`);
    for await (const name of dir.keys()) {
        const m = pattern.exec(name);
        if (m) counter = Math.max(counter, Number(m[1]));
    }
    const names = [];
    for (const b64 of images) {
        const name = `${base}_${String(++counter).padStart(5, "0")}.png`;
        const file = await dir.getFileHandle(name, { create: true });
        const writable = await file.createWritable();
        await writable.write(await (await fetch("data:image/png;base64," + b64)).blob());
        await writable.close();
        names.push(name);
    }
    return names;
}

function download(b64, name) {
    const a = document.createElement("a");
    a.href = "data:image/png;base64," + b64;
    a.download = name;
    a.click();
}

function hideWidget(widget) {
    widget.draw = () => {};
    widget.computeSize = () => [0, -4];
    widget.options = { ...(widget.options || {}), hidden: true };
}

function setup(node, withSave) {
    const prefixWidget = node.widgets?.find((w) => w.name === "filename_prefix");
    const autoWidget = node.widgets?.find((w) => w.name === "auto_download");
    let dirHandle;
    let images = [];
    let index = 0;

    const root = document.createElement("div");
    root.style.cssText = `display:flex;flex-direction:column;gap:6px;width:100%;height:100%;box-sizing:border-box;font-family:${FONT};`;

    const frame = document.createElement("div");
    frame.style.cssText = `
        position:relative;min-width:0;flex:1 1 0;border-radius:8px;overflow:hidden;
        background:var(--comfy-input-bg, #1a1a1e);border:1px solid var(--border-color, #3a3a40);box-sizing:border-box;
    `;

    const img = document.createElement("img");
    img.style.cssText = "width:100%;height:100%;object-fit:contain;display:none;";

    const empty = document.createElement("div");
    empty.textContent = "Run the workflow to preview";
    empty.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:#8a8a92;pointer-events:none;";

    const badge = document.createElement("div");
    badge.style.cssText = `
        position:absolute;top:6px;right:6px;padding:2px 7px;border-radius:5px;display:none;
        background:rgba(0,0,0,0.55);color:#ddd;font-size:10px;line-height:16px;
        font-variant-numeric:tabular-nums;pointer-events:none;
    `;
    frame.append(img, empty, badge);

    const bar = document.createElement("div");
    bar.style.cssText = "display:none;gap:6px;align-items:center;";

    function button(content) {
        const b = document.createElement("button");
        b.innerHTML = content;
        b.style.cssText = `
            display:inline-flex;align-items:center;justify-content:center;gap:5px;height:24px;padding:0 9px;
            border-radius:6px;border:1px solid var(--border-color, #3a3a40);background:var(--comfy-input-bg, #1a1a1e);
            color:var(--input-text, #ddd);font:500 11px ${FONT};cursor:pointer;
        `;
        return b;
    }

    const prev = button("‹");
    const next = button("›");
    const counter = document.createElement("span");
    counter.style.cssText = "font-size:11px;color:#8a8a92;font-variant-numeric:tabular-nums;";
    const status = document.createElement("span");
    status.style.cssText = `
        flex:1 1 0;min-width:0;overflow-x:auto;white-space:nowrap;text-align:right;font-size:11px;color:#8fd19e;
        scrollbar-width:none;
    `;
    let scrollFrame = 0;
    // A long name slowly scrolls to its end, and stays scrollable by wheel or drag.
    function scrollToEnd() {
        const distance = status.scrollWidth - status.clientWidth;
        if (distance <= 0) return;
        const duration = Math.max(800, distance * 25);
        const start = performance.now() + 600;
        const step = (now) => {
            const t = Math.min(Math.max((now - start) / duration, 0), 1);
            status.scrollLeft = distance * t;
            if (t < 1) scrollFrame = requestAnimationFrame(step);
        };
        scrollFrame = requestAnimationFrame(step);
    }
    function notify(names) {
        status.textContent = names.length > 1 ? `Saved ${names[0]} – ${names[names.length - 1]}` : `Saved ${names[0]}`;
        status.scrollLeft = 0;
        cancelAnimationFrame(scrollFrame);
        requestAnimationFrame(scrollToEnd);
    }
    const stopAutoScroll = () => cancelAnimationFrame(scrollFrame);
    status.addEventListener("wheel", (e) => {
        e.preventDefault();
        e.stopPropagation();
        stopAutoScroll();
        status.scrollLeft += e.deltaX || e.deltaY;
    }, { passive: false });
    status.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        stopAutoScroll();
        const x = e.clientX;
        const left = status.scrollLeft;
        status.setPointerCapture(e.pointerId);
        const move = (m) => (status.scrollLeft = left - (m.clientX - x));
        status.addEventListener("pointermove", move);
        status.addEventListener("pointerup", () => status.removeEventListener("pointermove", move), { once: true });
    });
    status.addEventListener("mouseenter", stopAutoScroll);
    bar.append(prev, counter, next, status);

    async function downloadAll(canPrompt) {
        const prefix = prefixWidget.value || "ComfyUI";
        if (dirHandle && (await canWrite(dirHandle, canPrompt).catch(() => false))) {
            try {
                notify(await writeToFolder(dirHandle, prefix, images));
                return;
            } catch (e) {
                console.warn("In-memory save to folder failed, using browser download:", e);
            }
        }
        // Staggered, since browsers block bursts of simultaneous downloads.
        const names = images.map((_, i) => `${prefix}_${String(i + 1).padStart(5, "0")}.png`);
        images.forEach((b64, i) => setTimeout(() => download(b64, names[i]), i * 300));
        notify(names);
    }

    if (withSave) {
        const save = button(`${DOWNLOAD_ICON}<span>Download</span>`);
        save.addEventListener("click", () => downloadAll(true));
        bar.append(save);
    }

    function show(i) {
        index = (i + images.length) % images.length;
        img.src = "data:image/png;base64," + images[index];
        counter.textContent = `${index + 1} / ${images.length}`;
        const multi = images.length > 1;
        prev.style.display = next.style.display = counter.style.display = multi ? "" : "none";
    }
    prev.addEventListener("click", () => show(index - 1));
    next.addEventListener("click", () => show(index + 1));
    img.addEventListener("load", () => {
        badge.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
        badge.style.display = "block";
    });

    const settings = document.createElement("div");
    if (withSave) {
        hideWidget(prefixWidget);
        hideWidget(autoWidget);
        settings.style.cssText = "display:flex;flex-direction:column;gap:8px;padding:4px 0 6px;";

        function row(label, control) {
            const r = document.createElement("div");
            r.style.cssText = "display:flex;align-items:center;gap:8px;";
            const l = document.createElement("span");
            l.textContent = label;
            l.style.cssText = "flex:0 0 92px;font-size:11px;color:#8a8a92;";
            control.style.flex = "1 1 0";
            control.style.minWidth = "0";
            r.append(l, control);
            return r;
        }

        const pathBtn = button("");
        pathBtn.style.justifyContent = "flex-start";
        pathBtn.style.overflow = "hidden";
        pathBtn.style.whiteSpace = "nowrap";
        const clearBtn = button("×");
        clearBtn.title = "Use browser downloads";
        const pathControl = document.createElement("div");
        pathControl.style.cssText = "display:flex;gap:4px;";
        pathControl.append(pathBtn, clearBtn);

        function showPath() {
            pathBtn.innerHTML = `${FOLDER_ICON}<span style="overflow:hidden;text-overflow:ellipsis">${dirHandle ? dirHandle.name : "Browser default"}</span>`;
            clearBtn.style.display = dirHandle ? "" : "none";
        }
        showPath();
        loadDirHandle().then((h) => {
            dirHandle = h;
            showPath();
        });

        const pickable = typeof window.showDirectoryPicker === "function";
        if (!pickable) pathBtn.disabled = true;
        pathBtn.title = pickable ? "Choose the folder downloads are saved to" : "Folder selection is not supported by this browser";
        pathBtn.addEventListener("click", async () => {
            try {
                dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
                await storeDirHandle(dirHandle);
                showPath();
            } catch (e) {
                if (e.name !== "AbortError") console.warn(e);
            }
        });
        clearBtn.addEventListener("click", async () => {
            dirHandle = undefined;
            await storeDirHandle(undefined);
            showPath();
        });

        const prefixInput = document.createElement("input");
        prefixInput.type = "text";
        prefixInput.style.cssText = `
            height:24px;padding:0 8px;box-sizing:border-box;border-radius:6px;font:500 11px ${FONT};
            border:1px solid var(--border-color, #3a3a40);background:var(--comfy-input-bg, #1a1a1e);color:var(--input-text, #ddd);
        `;
        prefixInput.addEventListener("input", () => (prefixWidget.value = prefixInput.value));

        const segment = document.createElement("div");
        segment.style.cssText = "display:flex;gap:2px;padding:2px;border-radius:7px;background:rgba(255,255,255,0.05);";
        const segmentButtons = [false, true].map((value) => {
            const btn = document.createElement("button");
            btn.textContent = value ? "True" : "False";
            btn.style.cssText = `
                flex:1 1 0;min-width:0;height:20px;padding:0 10px;font:500 11px ${FONT};border:none;border-radius:5px;
                cursor:pointer;transition:background .12s,color .12s;
            `;
            btn.addEventListener("pointerdown", (e) => e.stopPropagation());
            btn.addEventListener("click", () => {
                autoWidget.value = value;
                showAuto();
            });
            segment.append(btn);
            return btn;
        });
        function showAuto() {
            segmentButtons.forEach((btn, i) => {
                const active = !!autoWidget.value === !!i;
                btn.style.background = active ? "rgba(74,125,252,0.38)" : "transparent";
                btn.style.color = active ? "#b4c9ff" : "#8a8a90";
                btn.style.boxShadow = active ? "inset 0 0 0 1px rgba(110,155,255,0.65)" : "none";
            });
        }

        const syncSettings = () => {
            prefixInput.value = prefixWidget.value;
            showAuto();
        };
        syncSettings();
        const onConfigure = node.onConfigure;
        node.onConfigure = function () {
            onConfigure?.apply(this, arguments);
            syncSettings();
        };

        settings.append(row("Download path", pathControl), row("Filename prefix", prefixInput), row("Auto download", segment));
    }

    root.append(settings, frame, bar);
    forwardCanvasEvents(root);

    const domWidget = node.addDOMWidget("in_memory_preview_ui", "in_memory_preview_ui", root, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => MIN_FRAME_H + bar.offsetHeight + settings.offsetHeight,
        getMaxHeight: () => 8000,
        getHeight: () => Math.max(MIN_FRAME_H + bar.offsetHeight + settings.offsetHeight, node.size[1] - TITLE_H - NODE_MARGIN),
    });

    ignoreWidgetWidth(domWidget);

    node.onExecuted = function (message) {
        images = message?.in_memory_images ?? [];
        const has = images.length > 0;
        img.style.display = has ? "block" : "none";
        empty.style.display = has ? "none" : "flex";
        bar.style.display = has ? "flex" : "none";
        badge.style.display = "none";
        if (has) show(0);
        if (has && withSave && autoWidget.value) downloadAll(false);
    };

    node.resizable = true;
    const onResize = node.onResize;
    node.onResize = function (size) {
        size[0] = Math.max(size[0], MIN_NODE_W);
        return onResize?.apply(this, arguments);
    };
    if (node.size[0] < MIN_NODE_W) node.setSize([MIN_NODE_W, Math.max(node.size[1], withSave ? 380 : 280)]);
}

app.registerExtension({
    name: "comfyui-preview-save-image-in-memory",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "PreviewImageInMemory" && nodeData.name !== "SaveImageInMemory") return;
        const withSave = nodeData.name === "SaveImageInMemory";
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            setup(this, withSave);
        };
    },
});
