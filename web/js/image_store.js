const { app } = window.comfyAPI.app;
const { api } = window.comfyAPI.api;

// Browser-side blob store for Load Image (In-Memory).
//
// The image/mask widgets used to hold the whole base64 payload, which landed in the
// serialized workflow and overflowed localStorage (draft autosave). Now the widgets hold
// a short reference ("mem:<id>") and the bytes live in IndexedDB. The bytes are put back
// into the prompt right before it is queued (see installQueueHook).
//
// Retention policy (see gc()):
//   - keep the KEEP_RECENT most recently used images,
//   - keep every image/mask referenced by a live graph, a localStorage draft or a saved workflow,
//   - keep anything touched within a short grace window (just loaded, node just removed).

export const REF_PREFIX = "mem:";
const REF_RE = /mem:[A-Za-z0-9_-]+/g;

const DB_NAME = "in-memory-nodes";
const BLOBS = "blobs"; // { id, kind: "image" | "mask", blob, size, lastUsed }
const WFREFS = "wfrefs"; // { path, modified, ids } - cache of ids found in saved workflows
const KEEP_RECENT = 5;
const IMAGE_GRACE_MS = 5 * 60 * 1000;
const MASK_GRACE_MS = 30 * 60 * 1000;

let dbPromise = null;
function openDb() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                db.createObjectStore(BLOBS, { keyPath: "id" });
                db.createObjectStore(WFREFS, { keyPath: "path" });
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        dbPromise.catch(() => { dbPromise = null; });
    }
    return dbPromise;
}

async function tx(store, mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const result = fn(t.objectStore(store));
        t.oncomplete = () => resolve(result?.result ?? result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
    });
}

const reqToPromise = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
});

async function randomId() {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Content hash so loading the same file twice stores it once. Falls back to a random id when
// hashing is unavailable (insecure context) or the file is too large to buffer.
async function contentId(blob) {
    try {
        const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
        return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
        return randomId();
    }
}

// Writes made by the UI that must finish before a prompt is queued.
const pending = new Set();
export function track(promise) {
    pending.add(promise);
    const done = () => pending.delete(promise);
    promise.then(done, done);
    return promise;
}

export const isRef = (v) => typeof v === "string" && v.startsWith(REF_PREFIX);

export async function putImage(blob) {
    const id = await contentId(blob);
    await put(id, "image", blob);
    return REF_PREFIX + id;
}

export async function putMask(blob) {
    const id = "m-" + (await randomId());
    await put(id, "mask", blob);
    return REF_PREFIX + id;
}

async function put(id, kind, blob) {
    await tx(BLOBS, "readwrite", (s) => s.put({ id, kind, blob, size: blob.size, lastUsed: Date.now() }));
    scheduleGc(5000);
}

export async function getBlob(ref) {
    if (!isRef(ref)) return null;
    const rec = await tx(BLOBS, "readonly", (s) => s.get(ref.slice(REF_PREFIX.length)));
    return rec?.blob ?? null;
}

export async function touch(refs) {
    const ids = [...new Set(refs.filter(isRef).map((r) => r.slice(REF_PREFIX.length)))];
    if (!ids.length) return;
    const db = await openDb();
    await new Promise((resolve, reject) => {
        const t = db.transaction(BLOBS, "readwrite");
        const s = t.objectStore(BLOBS);
        for (const id of ids) {
            const g = s.get(id);
            g.onsuccess = () => {
                if (g.result) s.put({ ...g.result, lastUsed: Date.now() });
            };
        }
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
    });
}

// Legacy workflows stored the raw base64 in the widget; move it into the store.
export async function migrateBase64(b64, kind) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: "image/png" });
    return kind === "mask" ? putMask(blob) : putImage(blob);
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result.slice(r.result.indexOf(",") + 1));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
    });
}

// --- queue hook ------------------------------------------------------------
// Swap "mem:<id>" references in the outgoing prompt for the real base64 bytes. The
// workflow attached to the prompt (extra_pnginfo) is left alone, so it stays small.

function toast(summary, detail) {
    try {
        app.extensionManager?.toast?.add({ severity: "error", summary, detail, life: 8000 });
    } catch { /* toast is best effort */ }
}

async function inflatePrompt(output) {
    await Promise.allSettled([...pending]);
    const used = [];
    for (const [nodeId, node] of Object.entries(output ?? {})) {
        if (node?.class_type !== "LoadImageInMemory") continue;
        for (const key of ["image", "mask"]) {
            const ref = node.inputs?.[key];
            if (!isRef(ref)) continue;
            const blob = await getBlob(ref);
            if (!blob) {
                const msg = `Load Image (In-Memory) node ${nodeId}: the ${key} is not in this browser's storage ` +
                    "(workflow opened from another browser, or site data was cleared). Drop the image onto the node again.";
                toast("Image missing", msg);
                throw new Error(msg);
            }
            node.inputs[key] = await blobToBase64(blob);
            used.push(ref);
        }
    }
    touch(used).catch(() => {});
}

let hookInstalled = false;
export function installQueueHook() {
    if (hookInstalled) return;
    hookInstalled = true;
    const original = api.queuePrompt;
    api.queuePrompt = async function (number, data, ...rest) {
        if (data?.output) await inflatePrompt(data.output);
        return original.call(this, number, data, ...rest);
    };
}

// --- garbage collection -----------------------------------------------------

function idsIn(text, into) {
    for (const m of text.matchAll(REF_RE)) into.add(m[0].slice(REF_PREFIX.length));
}

function liveGraphIds(into) {
    const graph = app.graph ?? app.rootGraph;
    if (!graph) return;
    const data = graph.asSerialisable?.() ?? graph.serialize?.();
    if (data) idsIn(JSON.stringify(data), into);
}

// Drafts and open-tab state live in localStorage; scanning every value avoids depending on key names.
function localStorageIds(into) {
    for (let i = 0; i < localStorage.length; i++) {
        const v = localStorage.getItem(localStorage.key(i));
        if (v && v.includes(REF_PREFIX)) idsIn(v, into);
    }
}

async function savedWorkflowIds(into) {
    const cache = new Map((await tx(WFREFS, "readonly", (s) => s.getAll())).map((r) => [r.path, r]));
    const seen = new Set();
    for (const dir of ["workflows", "subgraphs"]) {
        const res = await api.fetchApi(`/userdata?dir=${dir}&recurse=true&split=false&full_info=true`);
        if (res.status === 404) continue;
        if (!res.ok) throw new Error(`listing ${dir} failed: ${res.status}`);
        for (const entry of await res.json()) {
            const rel = typeof entry === "string" ? entry : entry.path;
            if (!rel.endsWith(".json")) continue;
            const path = `${dir}/${rel}`;
            const modified = typeof entry === "string" ? null : entry.modified;
            seen.add(path);
            let rec = modified != null ? cache.get(path) : null;
            if (!rec || rec.modified !== modified) {
                const f = await api.fetchApi(`/userdata/${encodeURIComponent(path)}`);
                if (!f.ok) throw new Error(`reading ${path} failed: ${f.status}`);
                const found = new Set();
                idsIn(await f.text(), found);
                rec = { path, modified, ids: [...found] };
                await tx(WFREFS, "readwrite", (s) => s.put(rec));
            }
            rec.ids.forEach((id) => into.add(id));
        }
    }
    for (const path of cache.keys()) {
        if (!seen.has(path)) await tx(WFREFS, "readwrite", (s) => s.delete(path));
    }
}

let gcRunning = false;
export async function gc() {
    if (gcRunning) return;
    gcRunning = true;
    try {
        // Any failure while collecting references aborts the run: deleting nothing beats deleting wrongly.
        const referenced = new Set();
        liveGraphIds(referenced);
        localStorageIds(referenced);
        await savedWorkflowIds(referenced);

        const all = await tx(BLOBS, "readonly", (s) => s.getAll());
        const now = Date.now();
        const images = all.filter((r) => r.kind === "image").sort((a, b) => b.lastUsed - a.lastUsed);
        const keep = new Set(images.slice(0, KEEP_RECENT).map((r) => r.id));
        const doomed = all.filter((r) => {
            if (keep.has(r.id) || referenced.has(r.id)) return false;
            return now - r.lastUsed > (r.kind === "mask" ? MASK_GRACE_MS : IMAGE_GRACE_MS);
        });
        if (doomed.length) {
            await tx(BLOBS, "readwrite", (s) => doomed.forEach((r) => s.delete(r.id)));
        }
    } catch (err) {
        console.warn("[in-memory-nodes] image store cleanup skipped:", err);
    } finally {
        gcRunning = false;
    }
}

let gcTimer = 0;
export function scheduleGc(delayMs = 5000) {
    clearTimeout(gcTimer);
    gcTimer = setTimeout(gc, delayMs);
}

// Called when a node is deleted: refresh lastUsed so an undo within the grace window still finds its bytes.
export function released(refs) {
    touch(refs).catch(() => {}).finally(() => scheduleGc(5000));
}

// Scan the browser on startup too, so stale entries from earlier sessions get cleaned.
scheduleGc(15000);
installQueueHook();
