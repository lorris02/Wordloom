# Wordloom

Make words yours. A personal English vocabulary app for collecting unfamiliar words, practicing their meaning, and returning to them over time.

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
- Responsive layout, keyboard focus indicators, and reduced-motion support.
- Optional server-side AI sentence feedback using the OpenAI Responses API.

## Run locally

Requires Node.js 20 or newer. No package dependencies or installation step.

```sh
npm start
```

Open http://127.0.0.1:4173. Run validation with:

```sh
npm run check
npm test
```

## Hosting

The `public/` directory is a complete static app. GitHub Pages deployment is included in `.github/workflows/pages.yml`; select **GitHub Actions** as the Pages source. Each push to `main` runs checks and deploys the static app.

**GitHub Pages does not run the Node server.** Sentence practice on Pages uses an explicitly labeled self-review flow. It checks that your sentence includes the word and lets you compare against the definition/example; it does not judge semantic correctness or pretend to provide AI feedback.

For AI feedback, deploy `server.mjs` to a Node-compatible host and configure server environment variables `OPENAI_API_KEY` and optionally `OPENAI_MODEL` (default `gpt-4.1-mini`). Never place a key in `public/`, a commit, or a browser setting. To allow a hosting platform to reach the server, adapt the listen host to `0.0.0.0` in that deployment. The sample `.env.example` documents settings; the server reads process environment variables, not `.env` files automatically. You can use Node's `--env-file` flag locally.

AI is opt-in at the individual feedback request: the UI explains that the word, definition, and submitted sentence go to OpenAI. Requests set `store: false`, limit input/output size, and have timeouts. There is a basic in-memory rate limit and origin check; add authentication, durable per-user quotas, and a provider spending limit before exposing a paid AI service publicly. AI feedback can be wrong; review it critically. The live static app needs no AI credential.

## How review scheduling works

This is a simple interval scheduler, not FSRS or a clinically validated learning guarantee. Again schedules a retry in ten minutes and resets the interval. Hard grows the interval slowly (minimum one day); Got it starts at one day and doubles; Easy starts at three days and grows faster. “Growing strong” means an interval of at least fourteen days. Quizzes and cloze answers schedule reviews automatically. Sentence practice uses your own rating.

## Data and sources

Your collection and review history stay in this browser's local storage. Clearing site data, switching devices, or private browsing may lose them: export backups regularly. There is no account, cloud sync, notification delivery, or billing in this release. The last 20,000 review attempts are retained. Starter definitions/examples are original learning copy. Imported dictionary definitions link to their source; dictionary coverage and example availability vary. Lookups require connectivity and send only the requested words to the dictionary service. Browser speech synthesis may use device/browser voice services.

## Next steps

- Authenticated AI feedback with per-user quotas.
- Accounts and optional cloud sync.
- Stronger adaptive scheduling and delayed recall measurements.
- Multiple meanings, pronunciation variants, and richer contextual practice.
- Notifications and paid plans after demand validation.

## Project structure

```text
public/        Static interface, learning logic, starter content
server.mjs     Local server and optional AI feedback API
tests/         Scheduling, backup validation, and server tests
.github/       Tested GitHub Pages deployment workflow
```
