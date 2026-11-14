from __future__ import annotations

import json

from PIL.PngImagePlugin import PngInfo

from ..common import encode_images


class PreviewImageInMemory:
    """Sends the images to the frontend as base64 PNGs in the execution
    result, so nothing is written to temp/ or output/.
    """

    CATEGORY = "image"
    DESCRIPTION = (
        "Displays IMAGE tensors in the frontend. Prevents ComfyUI from writing the data to server disk.\n"
        "\n"
        "Processing: each image is PNG-encoded in memory and returned as base64 in the node's UI output.\n"
        "Server disk I/O: NONE. No data written to temp/ on the server\n"
        "Inputs: images (IMAGE)."
    )
    SEARCH_ALIASES = ["preview", "preview image", "in memory", "show image"]
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",)}}

    RETURN_TYPES = ()
    FUNCTION = "preview"

    def preview(self, images):
        return {"ui": {"in_memory_images": encode_images(images)}}


class SaveImageInMemory(PreviewImageInMemory):
    """Same as the preview node, plus a download button in the frontend that
    saves the images through the browser. The workflow is embedded in the PNGs
    like the core Save Image node. `auto_download` is read by the frontend only.
    """

    DESCRIPTION = (
        "Saves IMAGE tensors on the client machine. Prevents ComfyUI from writing the data to server disk.\n"
        "\n"
        "Processing: each image is PNG-encoded in memory with prompt and workflow metadata and returned as base64 in the node's UI output.\n"
        "Server disk I/O: NONE. No data written to output/ on the server\n"
        "Client output: browser download, or direct write to a selected local folder (File System Access API, Chromium-based browsers only).\n"
        "Inputs: images (IMAGE); filename_prefix (STRING), supports subfolders when a local folder is selected; auto_download (BOOLEAN), saves after every execution."
    )
    SEARCH_ALIASES = ["save", "save image", "download image", "in memory"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "filename_prefix": ("STRING", {"default": "ComfyUI"}),
                "auto_download": ("BOOLEAN", {"default": False}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    FUNCTION = "save"

    def save(self, images, filename_prefix="ComfyUI", auto_download=False, prompt=None, extra_pnginfo=None):
        metadata = PngInfo()
        if prompt is not None:
            metadata.add_text("prompt", json.dumps(prompt))
        for key, value in (extra_pnginfo or {}).items():
            metadata.add_text(key, json.dumps(value))
        return {"ui": {"in_memory_images": encode_images(images, metadata)}}


NODE_CLASS_MAPPINGS = {
    "PreviewImageInMemory": PreviewImageInMemory,
    "SaveImageInMemory": SaveImageInMemory,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PreviewImageInMemory": "Preview Image (In-Memory)",
    "SaveImageInMemory": "Save Image (In-Memory)",
}
