// Runs the quantized SlimSAM-50 encoder once per image, then answers point prompts with the small decoder.
// Named .mjs so ComfyUI does not load it as an extension.
import * as ort from "./ort/ort.wasm.min.mjs";

ort.env.wasm.wasmPaths = new URL("./ort/", import.meta.url).href;
ort.env.wasm.numThreads = 1;

const load = async (url) => ort.InferenceSession.create(await (await fetch(url)).arrayBuffer(), { executionProviders: ["wasm"] });
let decoder = null;
let embeddings = null;

self.onmessage = async ({ data }) => {
    try {
        if (data.encoderUrl) {
            self.postMessage({ status: "Loading model…" });
            const encoder = await load(data.encoderUrl);
            decoder = await load(data.decoderUrl);
            self.postMessage({ status: "Analyzing image…" });
            embeddings = await encoder.run({ [encoder.inputNames[0]]: new ort.Tensor("float32", data.pixels, [1, 3, data.size, data.size]) });
            await encoder.release();
            self.postMessage({ ready: true });
            return;
        }
        const out = await decoder.run({
            input_points: new ort.Tensor("float32", Float32Array.of(data.x, data.y), [1, 1, 1, 2]),
            input_labels: new ort.Tensor("int64", BigInt64Array.of(1n), [1, 1, 1]),
            image_embeddings: embeddings.image_embeddings,
            image_positional_embeddings: embeddings.image_positional_embeddings,
        });
        const masks = out.pred_masks.data.slice();
        self.postMessage({ id: data.id, masks, scores: out.iou_scores.data.slice() }, [masks.buffer]);
    } catch (error) {
        self.postMessage({ id: data.id, error: String(error?.message ?? error) });
    }
};
