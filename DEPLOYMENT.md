# Deploying ScheduleForge to production

This is the manual half of going to production - the part `render.yaml`
cannot do for you, because it needs an account, a credit card (or a free
tier), and a few clicks only a person can make. Read `server/index.js`'s
header comment first for what "production" means here and what it still
does not cover.

## What gets deployed where

Three pieces, one Render account:

- **`scheduleforge-server`** - the Node server (`server/`), built from
  `server/Dockerfile`, running the collaboration relay and the
  accounts/places/publishing HTTP API.
- **`scheduleforge-web`** - the React app (`web/`), built as a static site
  and served directly - no server-side rendering, nothing dynamic in it.
- **`scheduleforge-db`** - a managed Postgres database, used only by
  `scheduleforge-server`.

All three are defined in `render.yaml` at the repo root (a Render
"Blueprint"), so connecting the repo creates all three in one pass.

## Local development, now that there is a real database

`server/data.json` is gone; the server needs `DATABASE_URL` set to reach a
real Postgres, even locally. The quickest local one:

```bash
docker run -d --name scheduleforge-db -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=scheduleforge -p 5432:5432 postgres:16-alpine
```

Then, from `server/`, copy `.env.example` to `.env` and load it before
starting the server (the server reads real environment variables, not `.env`
files directly - use your shell, or a tool like `dotenv-cli`):

```bash
cd server
npm install
env $(cat .env | xargs) npm start
```

The first run creates its tables automatically (`server/db.js`'s `migrate`)
and, if `SEED_DEMO_ACCOUNTS=true` in your `.env`, the same four demo accounts
the classroom-grade version had (`admin`/`admin123`, `editor`/`editor123`,
`teacher`/`teacher123`, `student`/`student123`). Leave it `false` and the
server creates exactly one `admin` account instead, using `ADMIN_PASSWORD`
from `.env` (or, if that's blank too, a random password printed once to the
server's own log the moment it starts).

## Deploying to Render

**1. Create a Render account and connect GitHub.**
[dashboard.render.com](https://dashboard.render.com) → sign up → authorize
Render to see your GitHub repositories (you can limit it to just this one).

**2. New Blueprint.**
Dashboard → **New** → **Blueprint** → pick this repository. Render reads
`render.yaml` and shows the three services it is about to create
(`scheduleforge-db`, `scheduleforge-server`, `scheduleforge-web`), both
compute ones (`scheduleforge-db`, `scheduleforge-server`) pinned to the
`free` plan explicitly in the file - Render defaults a new service to a
*paid* starter plan if a Blueprint does not say otherwise, so this is not
optional to get the $0/month tier. The free Postgres database still expires
30 days after creation regardless (a 14-day grace period to upgrade before
Render deletes it, with email warnings before both) - fine for standing this
up and trying it, not something to leave unattended long-term without either
upgrading it or planning to recreate it.

**3. Add a card, fill in the prompted secrets, then deploy anyway.**
Even on the free plan, Render asks for payment information on file before a
Blueprint with a database will proceed - a real requirement, not a bug in
this repo's config, and one only you can complete (entering payment details
is not something to hand to an AI assistant, including this one). It also
asks for `ALLOWED_ORIGIN`, `ADMIN_PASSWORD`, `SENTRY_DSN`, `VITE_API_URL` and
`VITE_WS_URL` up front (each marked `sync: false` in `render.yaml`
specifically so you're asked, rather than committed to the repo). You do
not know the real URLs yet at this point - **leave `ALLOWED_ORIGIN`,
`VITE_API_URL` and `VITE_WS_URL` blank** and deploy anyway; the first build
of the web app will fail to reach the server, and that is expected. Fix it
in the next step. `SENTRY_DSN` can stay blank indefinitely (see "Error
tracking and uptime alerting" below); set `ADMIN_PASSWORD` now if you want
to choose it yourself rather than read a generated one out of the logs
afterward.

**4. Wire the two services together.**
Once both services exist, Render has assigned each a URL, something like:

- `https://scheduleforge-server-xxxx.onrender.com`
- `https://scheduleforge-web-xxxx.onrender.com`

Now:
- On `scheduleforge-server`'s **Environment** tab, set `ALLOWED_ORIGIN` to
  the web service's URL exactly (no trailing slash).
- On `scheduleforge-web`'s **Environment** tab, set `VITE_API_URL` to the
  server's URL, and `VITE_WS_URL` to the same URL with `wss://` instead of
  `https://`.
- Trigger a **Manual Deploy** on both services (an env var change alone does
  not rebuild a static site - Vite bakes `VITE_*` values in at build time,
  so this rebuild is what actually picks them up).

**5. Get the admin password.**
If you set `ADMIN_PASSWORD` in step 3, that's it. If you left it blank,
open `scheduleforge-server`'s **Logs** tab and look for the one-time message
printed the first time it started - it will not be shown again, and there is
no "forgot password" for the admin account itself (`server/store.js`'s
`resetPassword` explicitly refuses to touch `role = 'admin'`). If you lose
it, the recovery path is a one-off database update, not a button in the UI.

**6. Sign in, create your first real place.**
Visit the web service's URL, sign in as `admin`, and use the new **Places**
panel to add your actual institution before inviting anyone to register.

**7. (Optional) A custom domain.**
On `scheduleforge-web`, **Settings → Custom Domains** → add yours, then
point its DNS at the value Render gives you. Render issues and renews the
TLS certificate automatically. Once the domain works, repeat step 4 with the
new domain instead of the `onrender.com` one - `ALLOWED_ORIGIN` needs to
match wherever the web app is actually served from.

## After the first deploy

- **Every push to `master` auto-deploys** both `scheduleforge-server` and
  `scheduleforge-web` (Render's default for a Blueprint-created service).
  `.github/workflows/ci.yml` runs independently on the same push; it does
  not currently gate the Render deploy - add a required-status-check branch
  protection rule in GitHub's own repo settings if you want a red CI run to
  block a deploy rather than just being visible after the fact.
- **Logs**: each service's **Logs** tab in the Render dashboard, live-tailed
  - and worth reading as JSON rather than plain text once you're looking:
  `server/log.js` writes one JSON object per line (`time`, `level`,
  `message`, plus whatever context that event carries) specifically so a log
  viewer or a downstream tool can filter and search on those fields instead
  of grepping sentences.
- **A crashed server auto-restarts.** If the database is briefly unreachable
  on boot (a redeploy racing a database restart, say), `server/index.js`
  exits rather than retrying forever - Render treats that as a crash and
  restarts the service, which is the intended recovery path, not a bug.
- **Backups**: Render's managed Postgres takes automatic daily backups on
  every paid plan; the free tier does not - check your plan before relying
  on this being true for you.

## Error tracking and uptime alerting

Both need an account with someone else - nothing to check into this repo,
only environment variables and a URL to hand to a third party:

- **Error tracking (optional).** Every request error is already logged as
  structured JSON regardless of this - Sentry is for someone getting told
  about it. [Sign up at sentry.io](https://sentry.io), create a Node
  project, copy its DSN, and set `SENTRY_DSN` on `scheduleforge-server` (in
  Render's dashboard, or `render.yaml`'s `sync: false` prompt on next
  Blueprint sync). `server/errorTracking.js` picks it up automatically on
  the next restart - no code change, and nothing breaks if you never do this.
- **Uptime alerting.** Render restarts a crashed instance, but nothing pages
  a person unless you wire that up yourself: point a free monitor - e.g.
  [UptimeRobot](https://uptimerobot.com) or
  [Better Stack](https://betterstack.com/uptime) - at
  `https://<scheduleforge-server's URL>/healthz` and set it to alert you
  (email, SMS, whatever it supports) on a failed check.

## Scaling past one instance

`render.yaml` pins `scheduleforge-server` to exactly one instance
(`numInstances: 1`), and that is a real constraint, not a conservative
default: the collaboration relay keeps who-is-editing-what for every open
room in that one process's own memory (`server/index.js`'s `rooms` map). A
second instance would simply not see the first one's rooms - two people in
the "same" room could land on different instances and never see each
other's moves. Raising `numInstances` requires rebuilding that part as a
genuinely distributed system first (typically: Redis pub/sub relaying a move
or a lock between instances, since a client's WebSocket connection is
pinned to whichever single instance it landed on) - a real, non-trivial
project of its own, not a config change.

Login and registration rate limiting does **not** have this problem anymore:
`server/rateLimit.js` shares its counters across every instance through
Redis when `REDIS_URL` is set (falling back to counting per-process
otherwise), so that part alone would already be safe to scale if the
collaboration relay's constraint above did not block it first.
