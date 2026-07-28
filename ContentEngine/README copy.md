# Mini Content Engine

A small end-to-end content-generation workflow for a product name, description, and optional product reference image.

## Run locally

1. Copy `.env.example` to `.env`.
2. Start PostgreSQL: `docker compose up -d db`.
3. Install and run: `npm.cmd install` then `npm.cmd run dev`.
4. Open `http://localhost:3000`.

The app persists jobs in PostgreSQL. If the database is not currently reachable, it keeps jobs in memory so the UI remains demonstrable; `/health` reports which storage mode is active.

## API

- `POST /generate` — multipart form (`productName`, `description`, optional `image`, optional `imageUrl`) or JSON body.
- `GET /jobs` — recent jobs.
- `GET /jobs/:id` — one job and its result path when completed.
- `GET /health` — liveness and database status.

An optional `OPENAI_API_KEY` uses OpenAI to expand the product data into a prompt. Image output is intentionally a local SVG placeholder composed from that prompt and reference: the assignment permits this fallback, it makes the demo stable and avoids hidden paid dependencies. The generation adapter is isolated in `src/generation.js` for replacing with a real image model.
