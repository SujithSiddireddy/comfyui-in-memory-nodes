const { api } = window.comfyAPI.api;

// Client-side click-to-segment: quantized SlimSAM-50 (ONNX) run in a module worker.
// Only the model files are fetched (once, through the server route); the image never leaves the browser.
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

const SAM_SIZE = 1024;
const SAM_MASK_SIZE = 256;

export async function getModelStatus() {
    return (await api.fetchApi("/in_memory_nodes/models/status")).json();
}

export async function downloadModels() {
    const response = await api.fetchApi("/in_memory_nodes/models/download", { method: "POST" });
    if (!response.ok) throw new Error(`Model download failed (${response.status})`);
}

function modelUrl(name) {
    return new URL(api.apiURL(`/in_memory_nodes/model/${name}`), window.location.href).href;
}

// Encodes the image once with SlimSAM; predict(fx, fy) then returns { width, height, labels } for the object under a
// point given as fractions of the image, where labels is 1 inside the best-scoring mask and 0 elsewhere.
export function startSam(img, onStatus) {
    const scale = SAM_SIZE / Math.max(img.naturalWidth, img.naturalHeight);
    const width = Math.round(img.naturalWidth * scale);
    const height = Math.round(img.naturalHeight * scale);
    const input = document.createElement("canvas");
    input.width = width;
    input.height = height;
    const inputCtx = input.getContext("2d", { willReadFrequently: true });
    inputCtx.imageSmoothingQuality = "high";
    inputCtx.drawImage(img, 0, 0, width, height);
    const rgba = inputCtx.getImageData(0, 0, width, height).data;
    // Normalized pixels, zero-padded to the right and bottom.
    const plane = SAM_SIZE * SAM_SIZE;
    const pixels = new Float32Array(3 * plane);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            for (let c = 0; c < 3; c++) pixels[c * plane + y * SAM_SIZE + x] = (rgba[(y * width + x) * 4 + c] / 255 - MEAN[c]) / STD[c];
        }
    }

    const worker = new Worker(new URL("./vendor/sam_worker.mjs", import.meta.url), { type: "module" });
    const pending = new Map();
    let nextId = 0;
    let ready;
    const fail = (error) => {
        ready.reject(error);
        for (const request of pending.values()) request.reject(error);
        pending.clear();
    };
    worker.onerror = (e) => fail(new Error(e.message || "Segmentation worker failed"));

    return new Promise((resolve, reject) => {
        ready = { reject };
        worker.onmessage = ({ data }) => {
            if (data.status) return onStatus(data.status);
            if (data.ready) {
                worker.onmessage = ({ data: reply }) => {
                    const request = pending.get(reply.id);
                    pending.delete(reply.id);
                    if (reply.error) request.reject(new Error(reply.error));
                    else request.resolve(reply);
                };
                return resolve({ predict, dispose });
            }
            worker.terminate();
            reject(new Error(data.error));
        };
        worker.postMessage({ encoderUrl: modelUrl("slimsam_encoder"), decoderUrl: modelUrl("slimsam_decoder"), pixels, size: SAM_SIZE }, [pixels.buffer]);
    });

    async function predict(fx, fy) {
        const id = nextId++;
        const reply = await new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            worker.postMessage({ id, x: fx * width, y: fy * height });
        });
        let best = 0;
        for (let i = 1; i < 3; i++) if (reply.scores[i] > reply.scores[best]) best = i;
        const logits = reply.masks.subarray(best * SAM_MASK_SIZE * SAM_MASK_SIZE, (best + 1) * SAM_MASK_SIZE * SAM_MASK_SIZE);

        // The mask covers the padded 1024 square at quarter resolution: bilinear upsample the logits, keep > 0.
        const ratio = SAM_MASK_SIZE / SAM_SIZE;
        const maxX = Math.ceil(width * ratio) - 1;
        const maxY = Math.ceil(height * ratio) - 1;
        const labels = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) {
            const sy = Math.min(Math.max((y + 0.5) * ratio - 0.5, 0), maxY);
            const y0 = Math.floor(sy);
            const y1 = Math.min(y0 + 1, maxY);
            for (let x = 0; x < width; x++) {
                const sx = Math.min(Math.max((x + 0.5) * ratio - 0.5, 0), maxX);
                const x0 = Math.floor(sx);
                const x1 = Math.min(x0 + 1, maxX);
                const top = logits[y0 * SAM_MASK_SIZE + x0] * (1 - (sx - x0)) + logits[y0 * SAM_MASK_SIZE + x1] * (sx - x0);
                const bottom = logits[y1 * SAM_MASK_SIZE + x0] * (1 - (sx - x0)) + logits[y1 * SAM_MASK_SIZE + x1] * (sx - x0);
                if (top * (1 - (sy - y0)) + bottom * (sy - y0) > 0) labels[y * width + x] = 1;
            }
        }
        return { width, height, labels };
    }

    function dispose() {
        worker.terminate();
        fail(new Error("Segmentation was cancelled"));
    }
}
