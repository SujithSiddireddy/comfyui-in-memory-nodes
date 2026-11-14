# comfyui-in-memory-nodes

ComfyUI custom nodes that pass image/mask data as in-memory base64 strings instead of
files on disk. Nothing gets written to `input/`, `input/clipspace/`, `output/`, or `temp/`.

## Nodes

| Node | Purpose | Server disk I/O |
|------|---------|-----------------|
| Load Image (In-Memory) | Load an image and paint a mask | none (`input/`, `input/clipspace/`) |
| Preview Image (In-Memory) | Display images in the frontend | none (`temp/`) |
| Save Image (In-Memory) | Save images to the client machine | none (`output/`) |
| Compare Images (In-Memory) | Slider comparison of two images | none (`temp/`) |

### Load Image (In-Memory)

Drag-and-drop an image onto the node (or use the upload button) and paint a mask on the
canvas: brush/eraser tools, adjustable brush size, resizable node. The image and mask
are read client-side, sent as base64 PNG and decoded in memory into the `IMAGE`/`MASK`
outputs.

**Segment tab:** in the mask options, switch Mode to Segment. The first time, press "Download segmentation model" (35 MB,
nothing is downloaded until you do), then press "Click to auto segment the image" (a few
seconds). Then hover the image to preview segments and click one to add it to the mask; click
several to combine them, and switch to Paint or Erase to fix the gaps. It uses quantized
SlimSAM-50 (stored in `models/slimsam_50/`) in the browser through
a vendored ONNX Runtime Web, so the image is never uploaded.

### Preview Image (In-Memory)

Takes `images` and returns them to the frontend as base64 PNGs in the node's UI output.

### Save Image (In-Memory)

Takes `images`, `filename_prefix` and `auto_download`. Images are PNG-encoded in memory
with the prompt and workflow embedded as metadata, and saved on the client:

- **Download path:** a local folder chosen with the File System Access API (Chromium-based
  browsers, `localhost` or HTTPS). Files are numbered from the highest existing
  `<prefix>_NNNNN.png`, and `filename_prefix` may contain subfolders (`a/b/name`). Without
  a folder, or in other browsers, images are downloaded through the browser.
- **Auto download:** saves after every execution. If the browser has dropped write
  permission for the folder, it falls back to a browser download until the Download
  button is clicked once.

### Compare Images (In-Memory)

Takes `image_a` and `image_b` and shows them with a slider (A left, B right). Each image
can be downloaded separately. If batch sizes differ, the shorter batch is repeated.

## What stays off the server disk

The nodes keep image data out of `input/`, `input/clipspace/`, `output/` and `temp/`.
They do not make ComfyUI itself forget the data:

- Images still pass through server memory during execution, and the Preview, Save and
  Compare results stay in the in-memory execution history until it is cleared.
- Load Image stores its image and mask as base64 in the workflow, so they are written
  wherever the workflow is saved.

## Nodes 2.0

Layouts are tuned for both the classic frontend and Nodes 2.0.

## Installing

Via ComfyUI-Manager: search for "comfyui-in-memory-nodes" (or use "Install Missing
Custom Nodes" if you're loading a workflow that references it).

Manually:
```
cd ComfyUI/custom_nodes
git clone https://github.com/SujithSiddireddy/comfyui-in-memory-nodes.git
```
Restart ComfyUI.

## License

MIT — see [LICENSE](LICENSE).
