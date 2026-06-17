# Deploying TSD (Railway + Supabase + Hostinger)

Production layout:

```
Hostinger ──► WordPress (thesuccessdigest.com)         the CMS (already live)
Supabase  ──► Postgres                                  the data store (already live)
Railway   ──► 2 Node services from this repo:
                • web    = dashboard API + built UI      (public URL)
                • worker = poller + generation scheduler (no public port)
```

The agent/bridge run on Railway; WordPress stays on Hostinger; Postgres on Supabase.
Both Railway services run from this same repo — only the **start command** differs.

---

## 1. Prerequisites (already done)

- Supabase project + the schema applied (`db/001_init.sql`). For a fresh DB, run that SQL once.
- WordPress reachable with an Application Password (mu-plugin in place; CDN off or Authorization header allowed).
- Code pushed to GitHub.

## 2. Create the Railway project

1. Railway → **New Project → Deploy from GitHub repo** → pick this repo/branch.
2. Railway auto-detects Node (Nixpacks), runs `npm install` then `npm run build` (builds the dashboard UI), then `npm start`. This first service is your **web** service.

## 3. Configure the web service

- **Start command:** `npm start` (default — serves the API *and* the built dashboard on one public URL).
- Add a **public domain** (Railway → service → Settings → Networking → Generate Domain).
- Set the environment variables (see §5).

## 4. Add the worker service

1. In the same project → **New → GitHub Repo** → same repo (or "Empty Service" linked to the repo).
2. **Start command:** `npm run start:worker`.
3. Give it the **same environment variables** as the web service.
4. No public domain needed — it's a background worker.

> Railway runs one start command per service, so the `web` and `worker` are two
> services pointing at the same repo. (The `Procfile` documents both process types.)

## 5. Environment variables (set on BOTH services)

| Variable | Value |
|---|---|
| `DB_DRIVER` | `postgres` |
| `DATABASE_URL` | Supabase **pooler** URI (`...pooler.supabase.com:5432/postgres`, password URL-encoded) |
| `ANTHROPIC_API_KEY` | the project's Claude key |
| `WP_BASE_URL` | `https://thesuccessdigest.com` |
| `WP_USERNAME` | the WordPress account email |
| `WP_APP_PASSWORD` | the WordPress Application Password |
| `WP_SEO_PLUGIN` | `yoast` or `rankmath` if installed, else leave empty |
| `DASH_TOKEN` | a strong random string (see security note) |

The web service also needs the dashboard build to send the same token — set a build-time var on the **web** service:

| Variable | Value |
|---|---|
| `VITE_DASH_TOKEN` | same value as `DASH_TOKEN` |

`PORT` is provided by Railway automatically — the server reads it.

## 6. Deploy & verify

- Both services build and start. Open the web service URL → the dashboard loads.
- Turn the **Auto-gen** toggle on (or use **Generate now**) → a draft appears in the queue (the worker drafts on the editorial calendar; manual generate is immediate).
- Approve a draft → it publishes live to WordPress within the same action.

## Security notes (important)

- **The dashboard auth is placeholder-grade.** With `DASH_TOKEN` set, the API
  requires the token — but the token ships in the client bundle, so treat this as
  light protection, not real auth. Before exposing the dashboard publicly, put
  real authentication (or Railway private networking / an IP allowlist / a proxy
  with basic-auth) in front of the web service.
- **Rotate any secret that was ever shared in chat or committed** (Anthropic key,
  Supabase DB password, WP application password). Store secrets only in Railway's
  variables — never in the repo. `.env` is gitignored for local use only.
- Set a **strong, unique `DASH_TOKEN`** — anyone with it can approve/publish.

## Cost

- Generation cost is shown per post (in the item's editorial notes + worker logs).
  Tune it with the **Cost profile** dropdown (Balanced default) and the **Model**
  dropdown in the dashboard.
- For non-urgent scheduled volume, the Batch API (−50%) is a future option.
