# Wordloom

Make words yours. A personal English vocabulary app for collecting unfamiliar words, practicing their meaning, and returning to them over time.

**Live app:** https://wordloom.ilorijonathan947.workers.dev

## Features

- Add up to ten words at once with definitions from the [Free Dictionary API](https://dictionaryapi.dev/), or supply your own definition.
- Eight editable starter words so you can try it immediately.
- Browser speech synthesis for pronunciation; availability depends on your device.
- Flashcards with Again, Hard, Got it, and Easy review ratings.
- Word matching quizzes, fill-in-the-blank exercises, and sentence practice.
- Choose words from pasted reading material.
- Daily reviews, a five-review goal, activity history, and tricky-word tracking.
- Search, edit, sort, and remove saved words.
- Local browser storage and JSON backup export/import, including review history. Imports merge new words and keep existing entries.
- Passkey accounts: registration, sign-in, sign-out, additional passkeys, and single-use recovery codes.
- Account collections and review history saved in Cloudflare D1, with device backups, offline retry, and explicit conflict resolution.
- Guest mode remains available. Import guest words into an account only when you choose to.
- Responsive layout, keyboard focus indicators, and reduced-motion support.
- Optional server-side AI sentence feedback using the OpenAI Responses API.

## Run locally

Requires Node.js 22.13 or newer (Node 24 is recommended). Install the pinned dependencies first:

```sh
npm ci
npm start
```

Open http://127.0.0.1:4173. Run validation with:

```sh
npm run check
npm test
```

`npm start` builds the frontend and starts the optional Node demo, which supports guest mode and optional AI feedback. **Accounts require the Cloudflare Worker and D1**, not the Node demo. The automated account tests use an in-memory SQLite database and real signed WebAuthn proofs; no user account or hardware passkey is needed for tests.

## Accounts and saving

Click **Sign in â†’ Create account**, choose a display name and username, and create a passkey using your browser's device prompt. Wordloom uses [SimpleWebAuthn](https://simplewebauthn.dev/) for verification and requires user verification. Fingerprints, facial data, private passkey keys, and device PINs are not sent to Wordloom. A synced passkey can work on other devices through a compatible password manager; a device-bound passkey does not automatically follow you.

Save the recovery code shown after registration in your password manager or download it somewhere private. **Recover account** accepts your username and code, rotates the code, and revokes other sessions. Save the replacement code. Once signed in, you can add another passkey or replace the recovery code. There is no email/password login or email recovery. Losing all passkeys and your recovery code means you cannot recover the account through the app.

Sessions expire after 14 days and use `Secure`, `HttpOnly`, `SameSite=Lax`, host-scoped cookies. Session tokens and recovery codes are stored as SHA-256 hashes. Sign-in challenges expire after five minutes, are single-use, and verify the configured origin and RP ID. Writes require a same-origin request, account collections are selected by the session's user ID, and authentication/recovery attempts are rate-limited in D1.

The app saves signed-in words and progress to D1 and keeps a per-account device backup. Wait for **Saved to your account** before switching devices. Offline changes retry while the page is open and can resume after signing into the same account again. Conflicting changes are not silently merged: open Account, export a backup, then choose the cloud version or this device's version. Cloud collections allow up to 5,000 words and 20,000 reviews, with a 2 MB request limit.

Guest storage is separate from account storage. **Import guest words** merges guest words/history on the current device, keeping existing account words. Sign-out restores the guest collection and removes the account's device backup when everything has reached the cloud; unsaved changes remain cached so they can be recovered after signing in again. Device backups use ordinary browser storage, not encrypted storage. Export backups regularly, especially before clearing site data. There is no account-deletion interface, notifications, or billing yet.

## Hosting

The app is hosted on **Cloudflare Workers**. GitHub stores the source; the GitHub Pages deployment workflow has been removed.

This deployment packs the frontend assets into one Worker using esbuild because the connected deployment service could not authorize Cloudflare's separate static-asset upload endpoint. Every request counts toward the Workers request allowance. Accounts use the `wordloom-accounts` D1 database. Both services are compatible with Cloudflare's Free plan; no paid subscription or AI binding was enabled. Free-plan requests/queries fail when their allowances are exhausted. Check [Workers limits](https://developers.cloudflare.com/workers/platform/limits/#daily-requests) and [D1 pricing and allowances](https://developers.cloudflare.com/d1/platform/pricing/) before scaling. Billing permissions were unavailable through the connector, so existing account subscriptions were not inspected or changed.

Build the deployment module:

```sh
npm ci
npm run build
node --check .deploy/worker.mjs
```

The ignored `.deploy/worker.mjs` contains the app files, HTTP handler, and authentication library. `wrangler.jsonc` includes the build, `nodejs_compat`, `APP_ORIGIN`, and the D1 binding. The live database schema is already applied; migrations live in `cloudflare/migrations/`. With your own Cloudflare authentication, apply migrations and deploy using Wrangler:

```sh
npx wrangler d1 migrations apply wordloom-accounts --remote
npx wrangler deploy
```

For a local account-enabled preview, run Wrangler with a local D1 database and matching origin:

```sh
npx wrangler d1 migrations apply wordloom-accounts --local
npx wrangler dev --port 8787 --var APP_ORIGIN:http://localhost:8787
```

Use `http://localhost:8787`, not another hostname. Passkeys are bound to their RP hostname: changing the live hostname requires planning an account migration; old passkeys cannot authenticate on an unrelated hostname. Keep `APP_ORIGIN` exact, with no trailing slash. The connected Cloudflare API can also upload the built module with the same bindings. GitHub pushes do not automatically deploy.

Sentence practice on the live app uses an explicitly labeled self-review flow. It checks that your sentence includes the word and lets you compare against the definition/example; it does not judge semantic correctness or pretend to provide AI feedback. `/api/config` reports `aiAvailable: false`.

For AI feedback, deploy `server.mjs` to a Node-compatible host and configure server environment variables `OPENAI_API_KEY` and optionally `OPENAI_MODEL` (default `gpt-4.1-mini`). Never place a key in `public/`, a commit, or a browser setting. To allow a hosting platform to reach the server, adapt the listen host to `0.0.0.0` in that deployment. The sample `.env.example` documents settings; the server reads process environment variables, not `.env` files automatically. You can use Node's `--env-file` flag locally.

In the optional Node server, AI is opt-in at the individual feedback request: the UI explains that the word, definition, and submitted sentence go to OpenAI. Requests set `store: false`, limit input/output size, and have timeouts. There is a basic in-memory rate limit and origin check; add authentication, durable per-user quotas, and a provider spending limit before exposing a paid AI service publicly. AI feedback can be wrong; review it critically. The live Cloudflare app needs no AI credential.

## How review scheduling works

This is a simple interval scheduler, not FSRS or a clinically validated learning guarantee. Again schedules a retry in ten minutes and resets the interval. Hard grows the interval slowly (minimum one day); Got it starts at one day and doubles; Easy starts at three days and grows faster. â€œGrowing strongâ€ means an interval of at least fourteen days. Quizzes and cloze answers schedule reviews automatically. Sentence practice uses your own rating.

## Data and sources

Guest collections stay in browser storage; signed-in collections and review history are also saved in Cloudflare D1. The last 20,000 review attempts are retained. Starter definitions/examples are original learning copy. Imported dictionary definitions link to their source; dictionary coverage and example availability vary. Lookups require connectivity and send only the requested words to the dictionary service. Browser speech synthesis may use device/browser voice services. Account names, usernames, public passkey credentials, session/recovery hashes, and collections are stored in D1; hashed IP buckets are used for short-lived authentication rate limits. Cloudflare operates the hosting and database.

## Next steps

- Authenticated AI feedback with per-user quotas.
- Account deletion and more complete passkey management.
- Stronger adaptive scheduling and delayed recall measurements.
- Multiple meanings, pronunciation variants, and richer contextual practice.
- Notifications and paid plans after demand validation.

## Project structure

```text
public/        Static interface, learning logic, starter content
server.mjs     Local server and optional AI feedback API
tests/         Learning, HTTP, WebAuthn, account isolation, and offline sync tests
cloudflare/    Worker, authentication API, and D1 SQL migrations
scripts/       Frontend and Worker bundling with esbuild
wrangler.jsonc Cloudflare deployment configuration
```
