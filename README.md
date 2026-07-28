# Mini Content Engine

A small end-to-end content-generation service: submit a product name, description,
and reference image → an LLM turns it into an image-generation prompt → an image
is generated → the job and result are persisted and pollable via API.

Built for the GlitrAI take-home (Assignment 1 + Assignment 2).

## Status / what's real vs. mocked

Being upfront about this so it's clear what's actually running:

- **LLM prompt generation is real.** Every job calls Groq (`llama-3.3-70b-versatile`)
  to turn the product name + description into an image-generation prompt. This is
  live, not mocked.
- **Job persistence is real.** Jobs are written to and read from PostgreSQL
  (hosted on Supabase), with an in-memory fallback if the DB is unreachable so the
  app never hard-fails.
- **Image generation is currently a placeholder.** The service is fully wired to
  call a ComfyUI instance over its HTTP API (`src/comfyui.js`) — upload reference
  image, inject the LLM prompt into a saved img2img+upscale workflow, queue it,
  poll for completion, fetch the result. That code path works and is included in
  this repo. But my ComfyUI instance was only ever run **locally**, and I didn't
  keep it tunneled/hosted for this submission, so `COMFYUI_URL` isn't set in the
  deployed environment. As a result, every job falls through to a generated SVG
  placeholder (`generatePlaceholder()` in `src/generation.js`) instead of a real
  diffusion output. If a `COMFYUI_URL` is set (e.g. to a live ngrok tunnel), the
  exact same code path will call it and return a real generated image — no other
  code changes needed.

## Architecture

```
POST /generate
  → create job (status: pending) in Postgres
  → return 202 immediately with job id
  → async (setImmediate):
      status: processing
      → createPrompt()      Groq LLM call → image-gen prompt
      → generate image:
          if COMFYUI_URL set → generateWithComfyUI() (real diffusion, img2img + upscale)
          else               → generatePlaceholder() (SVG placeholder)
      → status: completed (or failed), store resultUrl

GET /jobs/:id   → poll job status + result
GET /jobs       → list recent jobs
GET /health     → storage mode (postgres/memory) + ComfyUI reachability
```

## Why these choices

- **Groq over OpenAI/others for the LLM step:** free tier, no card required, and
  fast enough (Llama 3.3 70B) that prompt generation doesn't become the
  bottleneck in the job pipeline.
- **Fallback at every external dependency:** no Groq key → deterministic local
  prompt template. No/unreachable Postgres → in-memory store. No/unreachable
  ComfyUI → SVG placeholder. The app is always demoable regardless of which
  free-tier service is up at any given moment.
- **Async job processing via `setImmediate`, not a separate worker/queue:** a real
  queue (BullMQ, SQS, etc.) is overkill for a "mini" version; `POST /generate`
  returns immediately and the job progresses through
  `pending → processing → completed/failed` in the same process, which is enough
  to demonstrate the job-tracking pattern the assignment asks for.
- **Node title-based injection into the ComfyUI workflow** (`Positive Prompt`,
  `Reference Image` in `workflow_api.json`) rather than hardcoded node IDs: makes
  the integration resilient to re-exporting the workflow after edits in the
  ComfyUI UI, as long as the two node titles are kept.

## Run locally

1. Create `.env` and fill in `DATABASE_URL` and `GROQ_API_KEY`.
2. `npm install`
3. `npm run dev`
4. Open `http://localhost:3000`

To actually exercise the ComfyUI path instead of the placeholder: run ComfyUI
(locally or on Colab per `comfyui/README.md`), expose it via ngrok, and set
`COMFYUI_URL` to that tunnel URL before starting the server.

## API

- `POST /generate` — multipart form (`productName`, `description`, optional
  `image` file, optional `imageUrl`) or JSON body.
- `GET /jobs` — recent jobs.
- `GET /jobs/:id` — one job, including `prompt` and `resultUrl` once completed.
- `GET /health` — liveness, storage mode, ComfyUI reachability.

## Assignment 2 — ComfyUI workflow

`comfyui/workflow_api.json` is an SDXL img2img + hi-res-fix workflow using only
core ComfyUI nodes (no custom nodes):

```
Load SDXL Checkpoint
  → Reference Image (LoadImage) → Encode Reference (VAEEncode)
  → Img2Img Sampler (KSampler, denoise 0.55)
  → Upscaler (LatentUpscaleBy, 1.5x)
  → Upscale Sampler (KSampler, denoise 0.35 — hi-res fix pass)
  → Decode (VAEDecode)
  → Save Output (SaveImage)
```

`Positive Prompt` and `Negative Prompt` are separate `CLIPTextEncode` nodes feeding
both KSampler stages. `src/comfyui.js` locates the `Positive Prompt` and
`Reference Image` nodes by their `_meta.title` and swaps in the LLM-generated
prompt and uploaded reference image before queuing the run.
