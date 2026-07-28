import fs from 'node:fs/promises';
import path from 'node:path';

const POSITIVE_PROMPT_TITLE = process.env.COMFY_POSITIVE_NODE_TITLE || 'Positive Prompt';
const REFERENCE_IMAGE_TITLE = process.env.COMFY_IMAGE_NODE_TITLE || 'Reference Image';
const NGROK_HEADERS = { 'ngrok-skip-browser-warning': 'true' };

let cachedWorkflow = null;

async function loadWorkflowTemplate() {
  if (cachedWorkflow) return cachedWorkflow;
  const workflowPath = process.env.COMFY_WORKFLOW_PATH || path.join('comfyui', 'workflow_api.json');
  const raw = await fs.readFile(workflowPath, 'utf8');
  cachedWorkflow = JSON.parse(raw);
  return cachedWorkflow;
}

function findNodeByTitle(workflow, title) {
  const entry = Object.entries(workflow).find(([, node]) => node?._meta?.title === title);
  return entry ? { id: entry[0], node: entry[1] } : null;
}

function findFirstNodeByClass(workflow, classType) {
  const entry = Object.entries(workflow).find(([, node]) => node?.class_type === classType);
  return entry ? { id: entry[0], node: entry[1] } : null;
}

async function fetchAsBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch reference image (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function uploadReferenceImage(comfyUrl, referenceImageUrl) {
  let buffer;
  let filename = 'reference.png';
  if (/^https?:\/\//i.test(referenceImageUrl)) {
    buffer = await fetchAsBuffer(referenceImageUrl);
    filename = path.basename(new URL(referenceImageUrl).pathname) || filename;
  } else {
    const localPath = path.join('uploads', path.basename(referenceImageUrl));
    buffer = await fs.readFile(localPath);
    filename = path.basename(referenceImageUrl);
  }

  const form = new FormData();
  form.append('image', new Blob([buffer]), filename);
  form.append('overwrite', 'true');

  const res = await fetch(`${comfyUrl}/upload/image`, { method: 'POST', headers: NGROK_HEADERS, body: form });
  if (!res.ok) throw new Error(`ComfyUI image upload failed (${res.status})`);
  const data = await res.json();
  return data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
}

function buildWorkflow(template, { prompt, imageName, randomizeSeed }) {
  const workflow = JSON.parse(JSON.stringify(template));

  const positive = findNodeByTitle(workflow, POSITIVE_PROMPT_TITLE) || findFirstNodeByClass(workflow, 'CLIPTextEncode');
  if (!positive) throw new Error(`Workflow is missing a prompt node (expected a node titled "${POSITIVE_PROMPT_TITLE}")`);
  positive.node.inputs.text = prompt;

  const imageNode = findNodeByTitle(workflow, REFERENCE_IMAGE_TITLE) || findFirstNodeByClass(workflow, 'LoadImage');
  if (!imageNode) throw new Error(`Workflow is missing a reference image node (expected a node titled "${REFERENCE_IMAGE_TITLE}")`);
  imageNode.node.inputs.image = imageName;

  if (randomizeSeed) {
    for (const node of Object.values(workflow)) {
      if (node.class_type === 'KSampler' || node.class_type === 'KSamplerAdvanced') {
        if ('seed' in (node.inputs || {})) node.inputs.seed = Math.floor(Math.random() * 1_000_000_000);
        if ('noise_seed' in (node.inputs || {})) node.inputs.noise_seed = Math.floor(Math.random() * 1_000_000_000);
      }
    }
  }

  return workflow;
}

async function queuePrompt(comfyUrl, workflow, clientId) {
  const res = await fetch(`${comfyUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...NGROK_HEADERS },
    body: JSON.stringify({ prompt: workflow, client_id: clientId })
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`ComfyUI rejected the workflow (${res.status}): ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  if (!data.prompt_id) throw new Error('ComfyUI did not return a prompt_id');
  return data.prompt_id;
}

async function waitForResult(comfyUrl, promptId, { timeoutMs = 180000, pollMs = 2000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${comfyUrl}/history/${promptId}`, { headers: NGROK_HEADERS });
    if (res.ok) {
      const history = await res.json();
      const entry = history[promptId];
      if (entry?.status?.completed) {
        const outputs = entry.outputs || {};
        for (const nodeOutput of Object.values(outputs)) {
          const image = nodeOutput?.images?.[0];
          if (image) return image; // { filename, subfolder, type }
        }
        throw new Error('ComfyUI job completed but produced no image output');
      }
      if (entry?.status?.status_str === 'error') {
        throw new Error('ComfyUI reported an execution error — check the Colab notebook logs');
      }
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  throw new Error('Timed out waiting for ComfyUI to finish the job');
}

export async function generateWithComfyUI({ id, prompt, referenceImageUrl }) {
  const comfyUrl = process.env.COMFYUI_URL?.replace(/\/$/, '');
  if (!comfyUrl) throw new Error('COMFYUI_URL is not configured');
  if (!referenceImageUrl) throw new Error('A reference image is required for the ComfyUI img2img workflow');

  console.log(`[comfyui] job ${id}: uploading reference image`);
  const template = await loadWorkflowTemplate();
  const imageName = await uploadReferenceImage(comfyUrl, referenceImageUrl);

  console.log(`[comfyui] job ${id}: queuing workflow`);
  const workflow = buildWorkflow(template, { prompt, imageName, randomizeSeed: true });
  const promptId = await queuePrompt(comfyUrl, workflow, id);

  console.log(`[comfyui] job ${id}: waiting for result (prompt_id=${promptId})`);
  const image = await waitForResult(comfyUrl, promptId);

  const params = new URLSearchParams({ filename: image.filename, type: image.type || 'output' });
  if (image.subfolder) params.set('subfolder', image.subfolder);
  const imageRes = await fetch(`${comfyUrl}/view?${params.toString()}`, { headers: NGROK_HEADERS });
  if (!imageRes.ok) throw new Error(`Failed to download generated image (${imageRes.status})`);
  const buffer = Buffer.from(await imageRes.arrayBuffer());

  const ext = path.extname(image.filename) || '.png';
  const outFile = `${id}${ext}`;
  await fs.writeFile(path.join('generated', outFile), buffer);
  console.log(`[comfyui] job ${id}: saved ${outFile}`);
  return `/generated/${outFile}`;
}
