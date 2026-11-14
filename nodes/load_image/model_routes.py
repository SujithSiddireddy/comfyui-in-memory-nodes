import os
import urllib.request

from aiohttp import web

import folder_paths
from server import PromptServer

SLIMSAM_URL = "https://huggingface.co/Xenova/slimsam-50-uniform/resolve/main/onnx/"

# name used by the frontend -> (download URL, path under models/, size in bytes)
MODELS = {
    "slimsam_encoder": (SLIMSAM_URL + "vision_encoder_quantized.onnx", "slimsam_50/vision_encoder_quantized.onnx", 30068885),
    "slimsam_decoder": (SLIMSAM_URL + "prompt_encoder_mask_decoder_quantized.onnx", "slimsam_50/prompt_encoder_mask_decoder_quantized.onnx", 4903810),
}


def _model_path(relative_path):
    return os.path.join(folder_paths.models_dir, relative_path)


def _models_downloaded():
    return all(os.path.isfile(_model_path(path)) for _, path, _ in MODELS.values())


def _download_models():
    for url, relative_path, _ in MODELS.values():
        path = _model_path(relative_path)
        if os.path.isfile(path):
            continue
        os.makedirs(os.path.dirname(path), exist_ok=True)
        partial = path + ".part"
        urllib.request.urlretrieve(url, partial)
        os.replace(partial, path)


@PromptServer.instance.routes.get("/in_memory_nodes/models/status")
async def get_models_status(request):
    return web.json_response({"downloaded": _models_downloaded(), "size": sum(size for _, _, size in MODELS.values())})


@PromptServer.instance.routes.post("/in_memory_nodes/models/download")
async def download_models(request):
    """Downloads the click-to-segment models. Only called after the user clicks the download button."""
    await request.loop.run_in_executor(None, _download_models)
    return web.json_response({"downloaded": True})


@PromptServer.instance.routes.get("/in_memory_nodes/model/{name}")
async def get_model(request):
    if request.match_info["name"] not in MODELS:
        raise web.HTTPNotFound()
    path = _model_path(MODELS[request.match_info["name"]][1])
    if not os.path.isfile(path):
        raise web.HTTPNotFound()
    return web.FileResponse(path)
