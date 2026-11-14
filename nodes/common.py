from __future__ import annotations

import base64
from io import BytesIO

import numpy as np
from PIL import Image
from PIL.PngImagePlugin import PngInfo


def encode_images(images, metadata: PngInfo | None = None) -> list[str]:
    out = []
    for image in images:
        arr = np.clip(255.0 * image.cpu().numpy(), 0, 255).astype(np.uint8)
        buf = BytesIO()
        Image.fromarray(arr).save(buf, format="PNG", pnginfo=metadata, compress_level=1)
        out.append(base64.b64encode(buf.getvalue()).decode("ascii"))
    return out
