# Alcovia Intervention Engine — Closed Loop Prototype

A product-first, closed-loop system connecting a Focus Mode web app (Expo), a backend API (Node.js + Postgres), and a human-in-the-loop automation (n8n). Built to detect struggling students in real-time, notify a mentor, and enforce remedial tasks.

## Architecture
- Backend: Node.js (Express) with Postgres (use Supabase or managed Postgres).
- Automation: n8n (cloud or self-hosted) for Mentor Dispatcher.
- Frontend: Expo (React Native) targeting Web.

Flow overview:
1) Student submits daily check-in → backend evaluates.
2) Failure → student locked; backend triggers n8n webhook.
3) n8n notifies mentor and waits for approval.
4) Mentor approves → n8n calls backend `/assign-intervention`.
5) App unlocks to Remedial state (only task visible) until student completes.

## SQL Schema
See `backend/schema.sql`. Tables:
- `students(id TEXT PRIMARY KEY, status TEXT, updated_at TIMESTAMP)`
- `daily_logs(id SERIAL, student_id TEXT, quiz_score INT, focus_minutes INT, status TEXT, created_at TIMESTAMP)`
- `interventions(id SERIAL, student_id TEXT, task TEXT, status TEXT, created_at TIMESTAMP, completed_at TIMESTAMP)`

## Backend API
- `POST /daily-checkin` → Body `{ student_id, quiz_score, focus_minutes }`
  - Success: `quiz_score > 7 && focus_minutes > 60` → `{"status":"On Track"}`
  - Failure: sets student `Needs Intervention`, triggers n8n webhook → `{"status":"Pending Mentor Review"}`
- `GET /student/:id/status` → `{ student_id, status, task }`
- `POST /assign-intervention` → Body `{ student_id, intervention_id?, task }` → sets status `Remedial`
- `POST /mark-complete` → Body `{ student_id }` → completes intervention and sets status `On Track`
- `GET /health`

Environment (`backend/.env`):
- `PORT=4000`
- `DATABASE_URL=postgres://USER:PASSWORD@HOST:PORT/DBNAME` (Supabase or Postgres)
- `N8N_WEBHOOK_URL=https://<your-n8n>/webhook/mentor-dispatcher`

Note: In local preview without `DATABASE_URL`, backend uses an in-memory store. For deployment, you must set `DATABASE_URL`.

## Frontend (Focus Mode)
States:
- Normal: daily check-in controls visible (quiz score, focus minutes).
- Locked: after failure, UI displays: “Analysis in progress. Waiting for Mentor…” and disables features.
- Remedial: after mentor assigns a task, only the remedial task is shown with a button “Mark Complete”.

Environment (`frontend/.env`):
- `EXPO_PUBLIC_API_URL=https://<your-backend-url>`

## Deploy Guide (ship in ~30–45 minutes)

### 1) Database (Supabase Postgres)
1. Create a Supabase project.
2. In SQL editor, run the contents of `backend/schema.sql`.
3. Copy the `postgresql://` connection string (Database → Settings → Connection string).

### 2) Backend (Render or Railway)
1. Push `backend/` to a GitHub repo.
2. On Render:
   - Create a new Web Service → connect your repo → Root Directory: `backend`
   - Build Command: `npm install`
   - Start Command: `npm run start`
   - Set Environment Variables:
     - `PORT=4000` (Render will override, expose on their port — OK)
     - `DATABASE_URL=<your Supabase connection string>`
     - `N8N_WEBHOOK_URL=<n8n webhook URL>`
3. Wait for deploy to complete; copy service URL (e.g., `https://alcovia-backend.onrender.com`).

### 3) Automation (n8n Cloud)
1. Sign in to n8n.cloud or your self-hosted n8n.
2. Import the workflow: `n8n/workflow.json`.
3. Configure the Email node:
   - Set SMTP credentials or use Slack node if preferred.
   - Set `toAddresses` to your email.
4. Publish the workflow and copy the webhook URL shown in the Webhook node.
5. Set that URL as `N8N_WEBHOOK_URL` in your backend.
6. In the Wait node, ensure “Resume via Webhook” is enabled. The email includes the auto-generated approval link.
7. Optionally set `backend_assign_url` in the Webhook input JSON to point to your backend `/assign-intervention` endpoint.

### 4) Frontend (Vercel or Netlify)
Option A: Vercel (static export):
1. In `frontend/`:
   - `npx expo export -p web` → outputs `dist/`
2. Deploy `dist/` folder to Vercel as a static site.
3. Set `EXPO_PUBLIC_API_URL` at build time or embed in `.env` and rebuild.

Option B: Vercel with build:
1. Set Project Root to `frontend`.
2. Build Command: `npx expo export -p web`.
3. Output Directory: `dist`.
4. Environment Variable: `EXPO_PUBLIC_API_URL=https://alcovia-backend.onrender.com`.

### Smoke Test
- Open the web app.
- Enter `student_123`.
- Submit bad check-in (e.g., score 4, minutes 30) → UI locks.
- n8n sends email; click approval link → backend receives `/assign-intervention` → UI shows remedial task.
- Click “Mark Complete” → status returns to `On Track`.

## Local Preview (already wired)
- Backend: `cd backend && npm run dev` (in-memory store if no `DATABASE_URL`).
- Frontend: `cd frontend && npm run web` → open `http://localhost:8081`.
- Frontend reads `EXPO_PUBLIC_API_URL` from `frontend/.env`.

## Fail-Safe (“Chaos” Component)
Problem: If a mentor doesn’t reply for 12 hours, the student remains locked.

Design a resilient fail-safe:
- Time-to-Live (TTL) on intervention locks:
  - Add `locked_at` (or use `interventions.created_at`) and enforce auto-unlock after X hours (e.g., 12h) if no mentor approval.
  - Backend `/student/:id/status` should return `On Track` once TTL expires OR a fallback “Auto-Remedial” task.
- Escalation policy:
  - n8n checks after 6 hours; if still pending, escalates via second notification to a Head Mentor group.
  - After 12 hours, n8n either assigns a default remedial task (e.g., “Watch Lesson Recap”) and hits `/assign-intervention`, or unlocks with a gentle reminder.
- Scheduled job:
  - Use n8n Cron node hourly to sweep `interventions` with `status='pending'` and `created_at < now() - interval '12 hours'`.
  - If found, execute the escalation/unlock path.
- UI feedback:
  - If unlocked by fail-safe, show banner: “Unlocked by system. Please complete Auto-Remedial task.”

This guarantees forward progress without mentor-induced deadlocks while preserving visibility and accountability.

## Notes
- Keep secrets in environment variables; never commit `.env`.
- For production, ensure `DATABASE_URL` is set. The in-memory fallback is only for local preview.
- You can swap Email with Slack easily in the n8n workflow.

## CI/CD in This Repository

This repo is wired for one-click deployments via GitHub Actions.

- Backend → Fly.io
  - Workflow: `.github/workflows/backend-fly-deploy.yml`
  - Required repo secrets:
    - `FLY_API_TOKEN` → Personal access token from Fly.io
    - `DATABASE_URL` → Postgres connection string (e.g., Supabase `postgresql://...`)
    - `N8N_WEBHOOK_URL` → Your n8n webhook endpoint (e.g., `https://<your-n8n>/webhook/mentor-dispatcher`)
  - App config: `fly.toml` with `backend/Dockerfile`
  - Trigger: Push to `main` touching `backend/**` or `fly.toml`
  - After deploy, copy the public backend URL (e.g., `https://<your-fly-app>.fly.dev`).

- Frontend → GitHub Pages
  - Workflow: `.github/workflows/frontend-pages.yml`
  - Required repo secret:
    - `EXPO_PUBLIC_API_URL` → The backend public URL (from Fly)
  - Trigger: Push to `main` (builds `frontend` and exports static site)
  - Result: Pages will publish to `https://<owner>.github.io/<repo>` automatically.

### Setup Steps (once)
1) Fly.io (backend)
   - Create the Fly app: `flyctl apps create intervention-backend` (or rename in `fly.toml`).
   - In repo Settings → Secrets, add: `FLY_API_TOKEN`, `DATABASE_URL`, `N8N_WEBHOOK_URL`.
   - Push to `main` to trigger backend deploy.

2) GitHub Pages (frontend)
   - In repo Settings → Pages, set Source to “GitHub Actions”.
   - In repo Settings → Secrets, add: `EXPO_PUBLIC_API_URL` with the backend URL.
   - Push to `main` to trigger frontend deploy.

3) n8n (automation)
   - Import `n8n/workflow.json` into n8n.
   - Configure Email node (SMTP or Slack) and publish.
   - Copy webhook URL and set it as `N8N_WEBHOOK_URL` secret.
   - Ensure the Wait node uses “Resume via Webhook”; approval emails include the auto-generated resume link.

### Health & Verification
- Backend: `GET /health` returns `{ ok: true }`.
- Frontend: loads status from `GET /student/:id/status` using `EXPO_PUBLIC_API_URL`.
- Smoke test:
  - Submit bad check-in → app locks and backend returns `Pending Mentor Review`.
  - Approval link → n8n calls `/assign-intervention` → app shows the remedial task.
  - Click “Mark Complete” → status returns to `On Track`.