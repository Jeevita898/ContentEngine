import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { createJob, getJob, initializeStore, listJobs, updateJob, usingDatabase } from './store.js';
import { createPrompt, generatePlaceholder } from './generation.js';
import { generateWithComfyUI } from './comfyui.js';

const app = express();
const port = Number(process.env.PORT || 3000);
await fs.mkdir('uploads', { recursive: true });
await fs.mkdir('generated', { recursive: true });
await initializeStore();

const upload = multer({ dest: 'uploads/', limits: { fileSize: 8 * 1024 * 1024 }, fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith('image/')) });
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use('/generated', express.static('generated'));

app.get('/health', async (_req, res) => {
  const health = { ok: true, storage: usingDatabase() ? 'postgresql' : 'memory-fallback' };
  if (process.env.COMFYUI_URL) {
    try {
      const r = await fetch(`${process.env.COMFYUI_URL.replace(/\/$/, '')}/system_stats`, {
        headers: { 'ngrok-skip-browser-warning': 'true' },
        signal: AbortSignal.timeout(4000)
      });
      health.comfyui = r.ok ? 'reachable' : `unreachable (status ${r.status})`;
    } catch (error) {
      health.comfyui = `unreachable (${error.message})`;
    }
  } else {
    health.comfyui = 'not configured';
  }
  res.json(health);
});
app.get('/jobs', async (_req, res, next) => { try { res.json(await listJobs()); } catch (error) { next(error); } });
app.get('/jobs/:id', async (req, res, next) => { try { const job = await getJob(req.params.id); if (!job) return res.status(404).json({ error: 'Job not found' }); res.json(job); } catch (error) { next(error); } });
app.post('/generate', upload.single('image'), async (req, res, next) => {
  try {
    const productName = req.body.productName?.trim();
    const description = req.body.description?.trim();
    if (!productName || !description) return res.status(400).json({ error: 'productName and description are required' });
    const id = crypto.randomUUID();
    const referenceImageUrl = req.file ? `/uploads/${path.basename(req.file.path)}` : req.body.imageUrl?.trim() || null;
    const job = { id, productName, description, referenceImageUrl, status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await createJob(job);
    setImmediate(() => processJob(job).catch(error => console.error(`Job ${id} failed:`, error)));
    res.status(202).json(job);
  } catch (error) { next(error); }
});

async function processJob(job) {
  try {
    await updateJob(job.id, { status: 'processing' });
    const prompt = await createPrompt(job.productName, job.description);

    let resultUrl;
    if (process.env.COMFYUI_URL) {
      try {
        resultUrl = await generateWithComfyUI({ id: job.id, prompt, referenceImageUrl: job.referenceImageUrl });
      } catch (comfyError) {
        console.error(`[job ${job.id}] ComfyUI generation failed: ${comfyError.message}`);
        if (process.env.COMFYUI_FALLBACK === 'false') throw comfyError;
        console.warn(`[job ${job.id}] Falling back to placeholder image`);
        resultUrl = await generatePlaceholder({ id: job.id, productName: job.productName, prompt });
      }
    } else {
      resultUrl = await generatePlaceholder({ id: job.id, productName: job.productName, prompt });
    }

    await updateJob(job.id, { status: 'completed', prompt, resultUrl });
  } catch (error) {
    console.error(`[job ${job.id}] failed: ${error.message}`);
    await updateJob(job.id, { status: 'failed', error: error.message });
  }
}

app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ error: 'Unexpected server error' }); });
app.listen(port, () => console.log(`Mini Content Engine listening at http://localhost:${port}`));
