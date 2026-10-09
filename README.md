# Wordloom 📚

**A vocabulary learning app built with JavaScript, Node.js, and MySQL.**

🌐 Live website: [wordloom-wfoe.onrender.com](https://wordloom-wfoe.onrender.com)

Wordloom helps learners collect unfamiliar English words, practice them through active recall, and revisit them over time. It brings vocabulary lookup, practice activities, and review tracking into one place.

## Features

- **Build a vocabulary collection:** Look up up to ten words at a time or add your own definitions.
- **Practice active recall:** Use flashcards, matching quizzes, cloze prompts, and sentence-writing exercises.
- **Learn from reading:** Pick vocabulary from pasted reading material.
- **Explore topics:** Discover related words through the Practice Studio.
- **Track progress:** See due reviews, learning activity, and difficult words.
- **Choose how to save:** Keep a guest collection in your browser or use an account to sync across devices when account services are configured.
- **Back up your words:** Export and import collections as JSON files.
- **Optional AI feedback:** Request feedback on a sentence when the server's AI integration is enabled.

## Tech Stack

| Area | Technologies |
|---|---|
| Frontend | JavaScript, HTML, CSS |
| Backend | Node.js |
| Database | MySQL, mysql2 |
| Authentication | Username/password accounts, optional WebAuthn passkeys through SimpleWebAuthn |
| Vocabulary services | Free Dictionary API, Datamuse |
| Optional integrations | OpenAI, Resend, Twilio |
| Build and testing | esbuild, Node.js test runner |
| Deployment | Render |

## Getting Started

### Requirements

- Node.js **22.13 or newer**
- npm
- A MySQL database if you want to enable accounts and collection syncing

### Installation

Download or clone this repository, then open a terminal in the project folder.

Install dependencies:

```bash
npm ci
```

Start the application:

```bash
npm start
```

Open **http://127.0.0.1:4173** in your browser.

Guest mode works without database credentials. Account features require the server configuration below.

### Account Configuration

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | MySQL connection string |
| `APP_ORIGIN` | Exact application origin, without a trailing slash |
| `PASSWORD_PEPPER` | Private server secret used to protect password verifiers |
| `DATABASE_CA` | Database provider's CA certificate, when required for TLS verification |

The server reads environment variables directly. A local `.env` file is not loaded automatically; use Node's `--env-file` option when launching the server, or provide the variables through your shell or hosting environment.

Keep `.env` files, database credentials, and API keys out of Git. A committed `.env.example` should contain placeholder values only.

## Using Wordloom

1. Look up unfamiliar words or add a word with your own definition.
2. Save words to your collection.
3. Practice with flashcards, quizzes, cloze prompts, or sentence writing.
4. Return to words that are due for review.
5. Check your activity and revisit difficult words.
6. Export a JSON backup to keep a separate copy of your collection.

## Accounts and Saving

**Guest mode** stores your collection in this browser. Clearing browser storage or switching devices can leave that collection unavailable, so export backups regularly.

**Account mode**, when configured, stores collections and review history in MySQL. Guest and account storage stay separate; you can import guest words after signing in.

Offline account changes retry while the page is open. If concurrent updates conflict, Wordloom asks which version to keep rather than silently merging them.

Accounts support usernames and passwords, optional passkeys, and optional email or phone recovery details. Recovery contacts are not verified at signup. Password resets require a configured delivery service; otherwise, the relevant reset option reports that setup is incomplete.

### Optional Services

| Service | Environment variables | Purpose |
|---|---|---|
| Email recovery | `RESEND_API_KEY`, `EMAIL_FROM` | Deliver password-reset emails |
| SMS recovery | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Deliver password-reset text messages |
| AI feedback | `OPENAI_API_KEY`, optional `OPENAI_MODEL` | Provide feedback on learner-written sentences |

The default AI model is `gpt-4.1-mini`. Before sending a request, the interface asks permission to share the word, definition, and sentence with OpenAI. Feedback can be incorrect and should be reviewed. Configure an API spending limit before enabling this publicly.

## Testing

Run the automated test suite:

```bash
npm test
```

Run the project's syntax checks:

```bash
npm run check
```

## Deployment

The repository includes a `render.yaml` Blueprint for a Node.js web service.

1. Connect the repository to Render using the Blueprint.
2. Provision a separate MySQL database.
3. Set `APP_ORIGIN` to the deployed HTTPS origin.
4. Add `DATABASE_URL` and the provider's `DATABASE_CA` certificate when required.
5. Confirm that `PASSWORD_PEPPER` has been generated by the Blueprint.
6. Configure any optional recovery or AI services you want to enable.

Wordloom creates its MySQL tables on first connection. Without database credentials, the deployment runs in guest mode and account sign-in is unavailable.

Passkeys are tied to the app's hostname. Changing the hostname later requires planning for existing accounts and passkeys.

For hosting limitations, see [Render's free-instance documentation](https://render.com/docs/free) and, if using Aiven, [Aiven's free MySQL documentation](https://aiven.io/docs/products/mysql/concepts/mysql-free-tier).

## Security and Privacy

- Passwords use salted PBKDF2-SHA-256 verifiers protected by a private server secret.
- Sessions expire after 14 days and use `Secure`, `HttpOnly`, and `SameSite=Lax` cookies.
- Session and recovery tokens are stored as hashes; reset links expire after 30 minutes and are single-use.
- Passkey challenges expire after five minutes, are single-use, and verify the configured origin and RP ID.
- Write requests require the same origin and are rate-limited.
- Account collections support up to 5,000 words and 20,000 reviews per user, with a 2 MB request limit.
- Fingerprints, facial data, private passkey keys, and device PINs are not sent to Wordloom.

## Data and Sources

Word definitions come from the Free Dictionary API. Topic suggestions use Datamuse. Word lookups send the requested words to the relevant service. Starter definitions and examples are original learning copy.

Browser speech synthesis may use device or browser voice services. AI feedback is optional and requires separate server configuration and user consent.

## Troubleshooting

**Account sign-in is unavailable**

Check `DATABASE_URL`, `APP_ORIGIN`, and `PASSWORD_PEPPER`. Confirm that the database is reachable and that its CA certificate is configured when required.

**Password-reset delivery is unavailable**

Configure the email or SMS delivery variables for the recovery method you want to use.

**Guest words are missing on another device**

Guest collections are browser-specific. Export and import a JSON backup, or use account syncing when enabled.

**Changes have not synced**

Keep the page open while offline updates retry. If a conflict appears, choose the version you want to retain.

[GitHub](https://github.com/lorris02) • [Portfolio](https://jonathanilori.com/) • [Email](mailto:ilorijonathan947@gmail.com)
