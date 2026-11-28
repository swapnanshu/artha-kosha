# Deploying Artha-Kosha

Everything runs on your own Firebase project plus a Vercel host. No databases,
queues or telemetry on any third-party SaaS.

## 1. Environment variables

Set exactly these on Vercel (Project → Settings → Environment Variables, all
Production **and** Preview unless noted).

| Name | Value | Notes |
| --- | --- | --- |
| `FIREBASE_PROJECT_ID` | `smartcar-17fdf` | plain |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | base64 of the service-account JSON | **Sensitive** |
| `OWNER_EMAIL` | `borkarswapnanshu@gmail.com` | plain |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | from Firebase web app config | public by design |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `smartcar-17fdf.firebaseapp.com` | public |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `smartcar-17fdf` | public |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | from Firebase web app config | public |
| `NEXT_PUBLIC_OWNER_EMAIL` | `borkarswapnanshu@gmail.com` | public |
| `NEXT_PUBLIC_USE_EMULATORS` | `false` | must be `false` |
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth web client id | Sensitive |
| `GOOGLE_OAUTH_CLIENT_SECRET` | OAuth web client secret | **Sensitive** |
| `TOKEN_ENC_KEY` | same value as local | **Sensitive** — changing it invalidates stored Gmail tokens |
| `SMS_WEBHOOK_SECRET` | same value as local | **Sensitive** |
| `CRON_SECRET` | same value as local | **Sensitive** |
| `BACKUP_BUCKET` | `artha-kosha-backups` | plain |

Do **not** set `FIRESTORE_EMULATOR_HOST` or `FIREBASE_AUTH_EMULATOR_HOST` on
Vercel: either one being present routes the Admin SDK to a non-existent local
emulator.

Copy each value from `.env.local` (never commit that file). Locally the file is
already git-ignored.

## 2. Google OAuth — register both redirect URIs

Google Cloud → APIs & Services → Credentials → your **Web** client →
Authorised redirect URIs. Each must match the origin the browser is on, exactly,
including port:

- `http://localhost:3100/api/ingest/gmail/callback` (local dev)
- `https://<your-project>.vercel.app/api/ingest/gmail/callback` (production)

The session cookie is scoped to one origin, so sign in on exactly the origin
Google returns to. In local development, open the app at
`http://localhost:3100` (not `127.0.0.1`, and not a proxy that rewrites the
`Host` header): the redirect URI above is built from the request host, so
visiting `127.0.0.1` sends Google a `localhost` return address and the callback
arrives without a session cookie. If you do need `127.0.0.1`, register that
URI too and use the same host throughout.

Also confirm on the OAuth consent screen that the scopes `gmail.readonly`,
`openid` and `email` are present, and that `borkarswapnanshu@gmail.com` is
listed as a test user.

Note that an External app left in **Testing** gets refresh tokens that expire
after 7 days. If Gmail sync stops with `invalid_grant` about a week after
connecting, that is this limit, not a bug: reconnect from /sources, and if it
recurs, set the consent screen's publishing status to **In production** (you
will see an "unverified app" warning when signing in, which is normal for a
restricted scope like `gmail.readonly` and safe to click through for your own
account).

## 2b. Firebase Auth — authorise the Vercel domain

`signInWithPopup` refuses any origin that is not listed in the Firebase project,
and the failure is a client-side `auth/unauthorized-domain` error before the page
ever reaches the server. Firebase only trusts `localhost` and
`<project>.firebaseapp.com` out of the box, so add every domain the app is served
from:

Firebase Console → **Authentication** → **Settings** → **Authorized domains** →
*Add domain*:

- `artha-kosha.vercel.app` (production)
- any Vercel preview alias you actually sign in on, e.g.
  `artha-kosha-git-main-<team>.vercel.app` (each preview URL is its own domain;
  there is no wildcard, so add the ones you use)

Do this once per Firebase project, not per deployment, and it takes effect
immediately — no redeploy needed.

## 3. Deploy on Vercel

1. Push this repo to GitHub (below), then Vercel → Add New → Project → import it.
2. Framework preset: **Next.js** (build `next build`, output `.next`). No
   `vercel.json` is needed.
3. Project → Settings → Functions → Region: **Mumbai (bom1)** — same city as the
   `asia-south1` Firestore database.
4. Add the environment variables from step 1, then deploy.
5. Add the Vercel redirect URI from step 2 to Google, then redeploy or just
   re-open /sources: environment changes only apply to a new deployment.
6. Open the deployment, sign in, and confirm /sources loads.

## 4. Push to GitHub

The repository is already initialised locally on `main` with one commit. It has
no remote yet:

```bash
# create an EMPTY repo on github.com (no README, no .gitignore), then:
git remote add origin https://github.com/<you>/artha-kosha.git
git push -u origin main
```

`git` will ask for a credential: use a fine-grained Personal Access Token
(GitHub → Settings → Developer settings → Tokens) with `Contents: read/write`
on that one repo, as the password. Or install the GitHub CLI and run
`gh auth login` once, then `gh repo create artha-kosha --private --source=. --push`.

## 5. Phone SMS forwarding (₹0)

**App:** [SMS to URL Forwarder](https://f-droid.org/packages/tech.bogomolov.incomingsmsgateway/)
by Konstantin Bogomolov — MIT, free, no account, no backend, no analytics. It
posts locally from the phone straight to your endpoint, so no SMS content
touches a third party. It cannot be on the Play Store (Google forbids
`RECEIVE_SMS` for this use case), so install it from F-Droid.

1. Install **F-Droid** (https://f-droid.org), then in F-Droid search
   *SMS to URL Forwarder* and install. If Play Protect warns, choose
   *Install anyway* — that warning is expected for every sideloaded SMS app.
2. Open the app, allow **SMS** permission and **notifications** (the `F`
   status-bar icon needs notifications on).
3. **+** → new forwarding rule:
   - **Sender**: tick *Sender is a regular expression*, then
     `(?i)hdfcbank|icici|axis|sbi|kotak|rbl|idfc|indusind|aubank|yesbank|niyo|cred|paytm|phonepe|gpay|amazonpay|amex`
     (bank sender IDs look like `VM-HDFCBK`, `AD-ICICIB`; the substring match
     handles the operator prefix).
   - **URL**: `https://<your-project>.vercel.app/api/ingest/sms`
   - **Payload**: leave the default —
     `{"from":"%from%","text":"%text%","sentStamp":%sentStamp%,"receivedStamp":%receivedStamp%,"sim":"%sim%"}`
     The endpoint understands this shape directly.
   - **Headers**: `{"x-webhook-secret":"<SMS_WEBHOOK_SECRET from .env.local>"}`
     (the app's built-in HMAC-SHA256 `X-Signature` option also works if you
     prefer a signature over a static header).
   - **Retries**: 10. **Chunked mode**: off (fixed-length is friendlier to
     hosts).
   - **Store failed messages**: on, so a dead network never loses an alert.
4. Tap **Test** — it should answer `{"ok":true,...}`. A real bank SMS then shows
   up in the ledger within seconds, with "last synced" moving on /sources.

### Make it survive Android 16

- Settings → Apps → SMS to URL Forwarder → **Battery** → *Unrestricted*
  (ASUS: also Mobile Manager → Auto-start manager → allow it).
- Settings → Apps → SMS to URL Forwarder → *Pause app activity if unused*: off.
- **Turn off RCS** in Google Messages (Settings → RCS chats → off). RCS
  messages never trigger the SMS broadcast, so a bank that switched you to RCS
  looks like "the app silently stopped".
- Keep the app's own **heartbeat** off unless you already run a monitor; it
  would be the only thing leaving your infrastructure.
- After a phone reboot, open the app once — the foreground-service icon should
  be back in the status bar.

## 6. Scheduled Gmail sync (₹0)

Vercel Hobby allows one daily cron; the plan calls for 15-minute sync, which is
free on Cloud Scheduler (3 jobs free per billing account):

```bash
gcloud scheduler jobs create http artha-kosha-sync \
  --project smartcar-17fdf --location us-central1 \
  --schedule "*/15 * * * *" --time-zone "Asia/Kolkata" \
  --uri "https://<your-project>.vercel.app/api/cron/sync" \
  --http-method GET \
  --headers "Authorization=Bearer <CRON_SECRET>"
```

`/api/cron/sync` also advances the 12-month Gmail backfill one page per call, so
a fresh connection fills itself in over the next few hours.
