# Hosting mPod on Render (API) and Vercel (website + admin portal)

```
 Students, staff
      │ HTTPS
      ▼
 Vercel ── website (/)  ·  admin portal (/admin)
      │
      ▼  /backend/... (API, photos, camera models)
 Render ── backend (Node) ──► MongoDB Atlas
                    └──────► AI: OpenAI, and/or the DGX Spark through a public HTTPS gateway
```

Files in the repository that do the setup:
- `render.yaml` (backend service);
- `vercel.json` (website and admin portal built together; `/backend` forwarded to Render).

## 0. Pick a setup

Login uses a strict same-site cookie, so the browser must see the website and the API as **the same site**.

| | **A. Your own domain (recommended)** | **B. No domain** |
|---|---|---|
| Website + admin | `https://mpod.yourcollege.edu` on Vercel | `https://<project>.vercel.app` |
| API | `https://api.mpod.yourcollege.edu` on Render | Same Vercel address. Vercel forwards `/backend/...` to Render. |
| Limits | None extra | Vercel sits in the middle: requests must start answering within 2 minutes; large uploads (a 50 MB photo zip) and per-student rate limits are untested through it |

Option B is fine for a trial. Use A for real exams.

## 1. Before you start

1. **Code on GitHub:** Render and Vercel deploy from your GitHub repository (`Abhi-5090/MPod`). Commit and push the branch you want to deploy, ideally merged into `main`.
2. **Database:** the MongoDB Atlas cluster you already use. In Atlas, go to **Network Access** and allow Render's outbound IP addresses (shown in Render under your service's **Connect → Outbound** tab), or allow `0.0.0.0/0`.
3. **AI:** Render runs on the internet and **cannot reach the DGX Spark at 192.168.14.123** (a campus-only address).
   - Start with OpenAI: `AI_PROVIDER=openai` and `OPENAI_API_KEY`.
   - Add the Spark later (section 5).

## 2. Backend on Render

1. Render dashboard → **New → Blueprint** → choose the repository. Render reads `render.yaml` and creates `mpod-backend` with:
   - Node 20, folder `backend`, health check `/backend/api/health`;
   - the **Starter** plan with a 1 GB disk at `/var/data`, which keeps uploaded photos and icons.

   The free plan won't do: it sleeps after 15 minutes idle (background scoring stops) and loses uploaded files.
2. Render asks for the values marked `sync: false`. Fill them in:

   | Setting | Value |
   |---|---|
   | `MONGODB_URI` | Your Atlas connection string (the same as in your `backend/.env`) |
   | `CORS_ORIGINS` | A: `https://mpod.yourcollege.edu` · B: `https://<project>.vercel.app` |
   | `PUBLIC_BACKEND_URL` | A: `https://api.mpod.yourcollege.edu/backend/` · B: `https://<project>.vercel.app/backend/` |
   | `AI_PROVIDER` | `openai` (or `dgx`, once section 5 is done) |
   | `OPENAI_API_KEY` | Your OpenAI key |
   | `DGX_BASE_URL`, `DGX_API_KEY` | Leave empty until section 5 |
   | `EMAIL_USER`, `EMAIL_PASS` | The Gmail account and app password used for password-reset emails |

   `JWT_SECRET` is generated automatically. Copy other settings from your `backend/.env` the same way if you changed them (interview timing, OpenAI models).
3. Deploy. The log should end with `Connected to DB` and `Server started`. Check `https://mpod-backend.onrender.com/backend/api/health` (your service's address may have a suffix).
4. **Option A:** service → **Settings → Custom Domains** → add `api.mpod.yourcollege.edu`, and create the CNAME record Render shows at your DNS provider.

Notes:
- Keep **one instance**. The scoring queue and rate limits live inside the process.
- Files uploaded on the old server (profile photos, icons): copy them into `/var/data/uploads/profile-pics`, `/var/data/uploads/technology-icons` and `/var/data/uploads/module-icons` using the service's **Shell** tab.

## 3. Website and admin portal on Vercel

1. Vercel → **Add New → Project** → import the same repository.
   - Leave **Root Directory** as the repository root.
   - Vercel reads `vercel.json`: it builds both apps into one site, with the website at `/` and the admin portal at `/admin`.
2. **Option B only:** check that the Render address in `vercel.json` (`https://mpod-backend.onrender.com`) is your service's real address. If not, edit it, then commit and push.
3. **Option A only:** before the first deploy, add two **Environment Variables** (Production). They are read at build time, so redeploy after changing them.
   - `VITE_API_URL` = `https://api.mpod.yourcollege.edu/backend/api/`
   - `VITE_BACKEND_URL` = `https://api.mpod.yourcollege.edu/backend/`
4. Deploy. **Option A:** Project → **Settings → Domains** → add `mpod.yourcollege.edu` and create the DNS record Vercel shows.
5. If the address differs from what you put in `CORS_ORIGINS` / `PUBLIC_BACKEND_URL` on Render, correct those on Render; the service restarts automatically.

## 4. Check it works

1. Open `https://<site>/admin`, log in as a platform admin. The dashboard loads with data.
2. **Settings → AI Model Usage**: OpenAI shows *Available* after **Test connection**.
3. Schedule a short technology interview for a test student. Take it at `https://<site>` with the camera on, and submit. The report shows scores and the camera analysis.
4. Upload a profile photo (Users → Update Profile pics), redeploy the backend, and check the photo is still there (the disk works).
5. Option B: also upload a large profile-photo zip. If it fails, upload smaller zips or move to option A.

## 5. Adding the DGX Spark (models on campus)

Render needs a **public HTTPS address** for the Spark. Never expose port 11434 directly: Ollama has no password.

Easiest without opening firewall ports: a **Cloudflare Tunnel** on the Spark. This needs a domain managed by Cloudflare.

1. On the Spark, set up the gateway from [DEPLOYMENT.md](../DEPLOYMENT.md), sections A4–A5. It checks an API key and blocks model deletion.
2. Install `cloudflared` on the Spark, then:
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create mpod-ai
   cloudflared tunnel route dns mpod-ai ai.yourcollege.edu
   ```
3. Point the tunnel at the gateway (not at Ollama) in `~/.cloudflared/config.yml`, then run it as a service: `sudo cloudflared service install`.
4. On Render, set:
   - `DGX_BASE_URL=https://ai.yourcollege.edu`
   - `DGX_API_KEY=<key from A5>`
   - `DGX_MODEL=gpt-oss:20b`
   - `DGX_CODING_MODEL=qwen3-coder:30b`
   - `DGX_NUM_CTX=8192`
5. In the admin portal, go to **Settings → AI Model Usage**, press **Test connection** on DGX Spark, then switch to it.

## 6. Costs (check current prices on each site)

- **Render Starter instance plus a 1 GB disk:** a few dollars a month.
- **Vercel Hobby:** free, but for non-commercial use; a college deployment may need **Pro**.
- **Atlas:** whatever you already pay.
- **OpenAI:** usage-based, while it serves the interviews.
