# comfyui-in-memory-nodes

ComfyUI custom nodes that pass image/mask data as in-memory base64 strings instead of
files on disk. Nothing gets written to `input/`, `input/clipspace/`, `output/`, or `temp/`.

## Nodes

### Load Image (In-Memory)

Drag-and-drop an image directly onto the node (or use the upload button) and paint a
mask right on the canvas — brush/eraser tools, adjustable brush size, resizable node.
Everything happens client-side; the image and mask are base64-encoded straight into
the node's `IMAGE`/`MASK` outputs.

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
