# ComfyUI workflow

`workflow_api.json` in this folder is a ready-to-use SDXL img2img + latent-upscale (hi-res fix)
workflow, built entirely from ComfyUI's core nodes — no custom nodes, no extra model downloads
beyond `sd_xl_base_1.0.safetensors`, which your Colab notebook already fetches.

Graph: `LoadImage → VAEEncode → KSampler (denoise 0.55) → LatentUpscaleBy (1.5x) → KSampler
(denoise 0.35, hi-res fix) → VAEDecode → SaveImage`

`src/comfyui.js` finds the `Positive Prompt` and `Reference Image` nodes by their `_meta.title`
(already set in this file) and injects the LLM-generated prompt and the uploaded reference image
before queuing the run — no further setup needed.

## Trying it in the ComfyUI UI first

Some recent ComfyUI builds let you drag this JSON straight onto the canvas to reconstruct the
graph visually. If that doesn't work on your build, rebuild it by hand node-for-node using the
same settings (see the main conversation / assignment notes) — the resulting graph is identical
either way, and titling the two nodes as above is what matters for the integration to work.

## Re-exporting after edits

If you tweak the workflow in the UI (different sampler, extra nodes, etc.), re-export via
**Workflow → Export (API)** (not the regular Save/Export) and overwrite this file, keeping the
`Positive Prompt` / `Reference Image` node titles intact.
