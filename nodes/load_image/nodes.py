from __future__ import annotations

import base64
from io import BytesIO

import numpy as np
import torch
from PIL import Image, ImageOps


def _decode_b64_image(data: str) -> Image.Image:
    if "," in data and data.strip().startswith("data:"):
        data = data.split(",", 1)[1]
    raw = base64.b64decode(data)
    img = Image.open(BytesIO(raw))
    img = ImageOps.exif_transpose(img)
    return img


class LoadImageInMemory:
    """Accepts an image and a paint mask as base64 PNG strings (set by the
    accompanying JS drag-and-drop / mask-paint widget) and decodes them
    straight into tensors, without ever writing to the input/ or
    input/clipspace/ folders on disk.
    """

    CATEGORY = "image"
    ESSENTIALS_CATEGORY = "Basics"
    SEARCH_ALIASES = ["load", "image", "load image", "in memory", "upload image", "paint mask", "mask"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("STRING", {"multiline": False, "default": ""}),
            },
            "optional": {
                "mask": ("STRING", {"multiline": False, "default": ""}),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "load"

    def load(self, image: str, mask: str = ""):
        if not image:
            raise ValueError("LoadImageInMemory: no image was provided (drag an image onto the node).")

        img = _decode_b64_image(image).convert("RGB")
        img_np = np.array(img).astype(np.float32) / 255.0
        img_tensor = torch.from_numpy(img_np)[None,]

        width, height = img.size

        if mask:
            mask_img = _decode_b64_image(mask).convert("L")
            if mask_img.size != (width, height):
                mask_img = mask_img.resize((width, height))
            mask_np = np.array(mask_img).astype(np.float32) / 255.0
            mask_tensor = torch.from_numpy(mask_np)[None,]
        else:
            mask_tensor = torch.zeros((1, height, width), dtype=torch.float32)

        return (img_tensor, mask_tensor)

    @classmethod
    def IS_CHANGED(cls, image: str, mask: str = ""):
        return hash((image, mask))


NODE_CLASS_MAPPINGS = {
    "LoadImageInMemory": LoadImageInMemory,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LoadImageInMemory": "Load Image (In-Memory)",
}
