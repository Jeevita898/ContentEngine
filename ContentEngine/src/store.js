import pg from 'pg';

const { Pool } = pg;
let pool = null;
let databaseReady = false;
const memory = new Map();

export async function initializeStore() {
  if (!process.env.DATABASE_URL) return false;
  try {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2500 });
    await pool.query(`CREATE TABLE IF NOT EXISTS jobs (
      id UUID PRIMARY KEY,
      product_name TEXT NOT NULL,
      description TEXT NOT NULL,
      reference_image_url TEXT,
      prompt TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending','processing','completed','failed')),
      result_url TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    databaseReady = true;
    return true;
  } catch (error) {
    console.warn(`PostgreSQL unavailable; using memory store: ${error.message}`);
    await pool?.end().catch(() => {});
    pool = null;
    return false;
  }
}

export const usingDatabase = () => databaseReady;

export async function createJob(job) {
  if (!databaseReady) { memory.set(job.id, job); return job; }
  await pool.query(`INSERT INTO jobs (id,product_name,description,reference_image_url,status,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,NOW(),NOW())`, [job.id, job.productName, job.description, job.referenceImageUrl, job.status]);
  return job;
}

export async function updateJob(id, changes) {
  if (!databaseReady) { const job = memory.get(id); if (!job) return null; Object.assign(job, changes, { updatedAt: new Date().toISOString() }); return job; }
  const entries = Object.entries(changes);
  if (!entries.length) return getJob(id);
  const fields = entries.map(([key], i) => `${camelToSnake(key)} = $${i + 1}`).join(', ');
  const values = entries.map(([, value]) => value);
  const result = await pool.query(`UPDATE jobs SET ${fields}, updated_at = NOW() WHERE id = $${values.length + 1} RETURNING *`, [...values, id]);
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function getJob(id) {
  if (!databaseReady) return memory.get(id) ?? null;
  const result = await pool.query('SELECT * FROM jobs WHERE id = $1', [id]);
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function listJobs() {
  if (!databaseReady) return [...memory.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const result = await pool.query('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50');
  return result.rows.map(mapRow);
}

function camelToSnake(key) { return key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`); }
function mapRow(row) {
  return {
    id: row.id, productName: row.product_name, description: row.description,
    referenceImageUrl: row.reference_image_url, prompt: row.prompt, status: row.status,
    resultUrl: row.result_url, error: row.error,
    createdAt: row.created_at?.toISOString(), updatedAt: row.updated_at?.toISOString()
  };
}
