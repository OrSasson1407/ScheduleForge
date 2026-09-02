# Deploying ScheduleForge to production

This is the manual half of going to production - the part `render.yaml`
cannot do for you, because it needs an account, a credit card (or a free
tier), and a few clicks only a person can make. Read `server/index.js`'s
header comment first for what "production" means here and what it still
does not cover.

## What gets deployed where

Two pieces on Render, plus one on Firebase:

- **`scheduleforge-server`** - the Node server (`server/`), built from
  `server/Dockerfile`, running the collaboration relay and the
  accounts/places/publishing HTTP API.
- **`scheduleforge-web`** - the React app (`web/`), built as a static site
  and served directly - no server-side rendering, nothing dynamic in it.
- **A Firestore database**, in a Firebase project - not something Render
  provisions. Chosen specifically because its free (Spark) tier is free
  indefinitely, no card, no expiration - unlike Render's own free Postgres,
  which is deleted 30 days after creation. `scheduleforge-server` is the
  only thing that ever talks to it, through the Admin SDK
  (`server/db.js`), never a client SDK in the browser.

The two Render services are defined in `render.yaml` at the repo root (a
Render "Blueprint"), so connecting the repo creates both in one pass. The
Firebase project is set up once, by hand, first (below).

## Local development

The server needs either a real Firebase project or the local Firestore
emulator - never a database on your own machine the way Postgres would have
needed one. For local development and running the test suite, the emulator
is the right choice; it needs the Firebase CLI and a JVM (Firestore's
emulator is Java-based):

```bash
npm install -g firebase-tools
```

Then, from `server/`:

```bash
npm install
npm run test:ci        # starts the emulator, runs server/test/api.test.js against it, stops it
```

To run the server itself against the emulator (rather than just the tests),
start the emulator in one terminal and the server in another, both pointed
at it - copy `.env.example` to `.env`, keep its
`FIRESTORE_EMULATOR_HOST`/`FIREBASE_PROJECT_ID` lines as they are, and load
it before starting (the server reads real environment variables, not `.env`
files directly - use your shell, or a tool like `dotenv-cli`):

```bash
firebase emulators:start --only firestore --project scheduleforge-dev   # terminal 1
```

```bash
env $(cat .env | xargs) npm start   # terminal 2
```

The emulator starts empty every time (nothing persists between runs unless
you pass `--export-on-exit`/`--import`), so the first request creates the
bootstrap admin account fresh, and `SEED_DEMO_ACCOUNTS=true` in `.env` seeds
the same four demo accounts the classroom-grade version had
(`admin`/`admin123`, `editor`/`editor123`, `teacher`/`teacher123`,
`student`/`student123`).

## Setting up the Firebase project

**1. Create the project.**
[console.firebase.google.com](https://console.firebase.google.com) → Add
project → name it, decline Google Analytics (not needed here) → Create.

**2. Create the Firestore database.**
In the new project, **Build → Firestore Database → Create database**. Any
region is fine (pick one close to wherever Render deploys the server, if you
want to minimize latency); start in **production mode** - the security rules
this repo ships (`server/firestore.rules`) deny every client-side read and
write on purpose, since only the server's Admin SDK ever touches this data,
and production mode matches that ruleset's intent. Confirm the plan shown is
**Spark (free)**.

**3. Generate a service account key.**
**Project settings (gear icon) → Service accounts → Generate new private
key**. This downloads a JSON file - treat it exactly like a password, never
commit it to the repository. Its entire content (as one line, or however
your platform accepts a multi-line secret) is what `FIREBASE_SERVICE_ACCOUNT`
is set to in the next section.

## Deploying to Render

**1. Create a Render account and connect GitHub.**
[dashboard.render.com](https://dashboard.render.com) → sign up → authorize
Render to see your GitHub repositories (you can limit it to just this one).

**2. New Blueprint.**
Dashboard → **New** → **Blueprint** → pick this repository. Render reads
`render.yaml` and shows the two services it is about to create
(`scheduleforge-server`, `scheduleforge-web`), `scheduleforge-server` pinned
to the `free` plan explicitly in the file - Render defaults a new service to
a *paid* starter plan if a Blueprint does not say otherwise, so this is not
optional to get the $0/month tier. Unlike the Postgres this project used to
run on, there is no expiration to plan around here - Firestore's free tier
is free indefinitely.

**3. Fill in the prompted secrets, then deploy anyway.**
Render may still ask for payment information on file even on the free plan
(a $1 verification charge that is refunded, not an actual bill) - if so,
that is only you to complete, the same as any payment detail (entering
payment or card information is not something to hand to an AI assistant,
including this one). It also asks for `FIREBASE_SERVICE_ACCOUNT`,
`ALLOWED_ORIGIN`, `ADMIN_PASSWORD`, `SENTRY_DSN`, `VITE_API_URL` and
`VITE_WS_URL` up front (each marked `sync: false` in `render.yaml`
specifically so you're asked, rather than committed to the repo). Paste in
`FIREBASE_SERVICE_ACCOUNT` now (the whole JSON key from Firebase step 3
above) - the server will not start without it. You do not know the real
service URLs yet at this point - **leave `ALLOWED_ORIGIN`, `VITE_API_URL`
and `VITE_WS_URL` blank** and deploy anyway; the first build of the web app
will fail to reach the server, and that is expected. Fix it in the next
step. `SENTRY_DSN` can stay blank indefinitely (see "Error tracking and
uptime alerting" below); set `ADMIN_PASSWORD` now if you want to choose it
yourself rather than read a generated one out of the logs afterward.

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
- **A crashed server auto-restarts.** If Firestore is briefly unreachable on
  boot, or `FIREBASE_SERVICE_ACCOUNT` is missing or malformed,
  `server/index.js` throws rather than starting half-working - Render treats
  that as a crash and restarts the service, which is the intended recovery
  path, not a bug.
- **Backups**: the Spark (free) plan does not include Firestore's managed
  scheduled backups, which needs the pay-as-you-go Blaze plan - check the
  Firebase console's current options before relying on any particular
  backup mechanism being active for you.

## Forgot-password email

Optional, the same shape as the two integrations below it: an account with
someone else, one environment variable, nothing to check into this repo.
Left unset, a "forgot password" request still works end to end in every way
except the actual emailing - the reset link is written to this service's own
logs instead (`server/email.js`), which is genuinely fine for trying the app
out or for a class where an admin is comfortable resetting passwords by
hand, but not for real self-service use.

To turn on the real email: [sign up at resend.com](https://resend.com)
(their free tier - 3,000 emails/month - is far more than this app will ever
send), create an API key, and set `RESEND_API_KEY` on `scheduleforge-server`
(Render's dashboard, or `render.yaml`'s `sync: false` prompt on next
Blueprint sync). Resend's own sandbox sending address
(`onboarding@resend.dev`) works immediately with no domain setup, which is
what `server/email.js` uses by default; set `RESEND_FROM_ADDRESS` too once
you verify your own sending domain with Resend, so the email does not arrive
from a stranger's address.

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
