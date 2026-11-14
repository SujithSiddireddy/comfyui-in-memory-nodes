from __future__ import annotations

from ..common import encode_images


class CompareImagesInMemory:
    """Sends two image batches to the frontend as base64 PNGs for a
    side-by-side slider comparison, without writing anything to disk.
    """

    CATEGORY = "image"
    DESCRIPTION = (
        "Compares two IMAGE batches with a slider in the frontend. Prevents ComfyUI from writing the data to server disk.\n"
        "\n"
        "Processing: each image is PNG-encoded in memory and returned as base64 in the node's UI output.\n"
        "Server disk I/O: NONE. No data written to temp/ on the server\n"
        "Inputs: image_a (IMAGE), image_b (IMAGE). If batch sizes differ, the shorter batch is repeated."
    )
    SEARCH_ALIASES = ["compare", "compare images", "diff", "before after", "in memory"]
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"image_a": ("IMAGE",), "image_b": ("IMAGE",)}}

    RETURN_TYPES = ()
    FUNCTION = "compare"

    def compare(self, image_a, image_b):
        return {"ui": {"compare_a": encode_images(image_a), "compare_b": encode_images(image_b)}}


NODE_CLASS_MAPPINGS = {
    "CompareImagesInMemory": CompareImagesInMemory,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CompareImagesInMemory": "Compare Images (In-Memory)",
}
