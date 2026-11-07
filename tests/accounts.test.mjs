import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { accountAPI, ApiError, json } from '../server/accounts.mjs';
import { starterWords } from '../public/starter.js';

const origin = 'https://wordloom.example';
const migrations = ['0001_accounts.sql', '0002_password_accounts.sql', '0003_contact_password_reset.sql', '0004_email_confirmation.sql'];
function database(files = migrations) {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of files)
    sqlite.exec(readFileSync(new URL('../server/migrations/' + file, import.meta.url), 'utf8'));
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let args = [];
      return {
        bind(...values) {
          args = values;
          return this;
        },
        async first() {
          return statement.get(...args) || null;
        },
        async all() {
          return { results: statement.all(...args) };
        },
        async run() {
          return { meta: statement.run(...args) };
        },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { db, sqlite };
}
function fixture(t, { emailSetUp = true, files } = {}) {
  const { db, sqlite } = database(files);
  t.after(() => sqlite.close());
  const jar = new Map();
  // Emails are caught here instead of going to Resend.
  const mail = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url) !== 'https://api.resend.com/emails') return realFetch(url, options);
    mail.push(JSON.parse(options.body));
    return new Response('{}', { status: 200 });
  };
  t.after(() => (globalThis.fetch = realFetch));
  const mailTo = address => mail.filter(m => m.to[0] === address).at(-1);
  const linkToken = (address, key = 'confirmEmail') =>
    mailTo(address)?.text.match(new RegExp(`\\?${key}=([A-Za-z0-9_-]{43})`))?.[1];
  return {
    db,
    sqlite,
    jar,
    mail,
    mailTo,
    linkToken,
    async call(path, body, method = body === undefined ? 'GET' : 'POST', extra = {}) {
      const headers = {
        Origin: origin,
        'X-Client-IP': '192.0.2.1',
        Cookie: [...jar].map(([k, v]) => k + '=' + v).join('; '),
        ...extra,
      };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const request = new Request(origin + '/api/' + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let response;
      try {
        response = await accountAPI(request, {
          DB: db,
          APP_ORIGIN: origin,
          PASSWORD_PEPPER: pepper,
          ...(emailSetUp ? { RESEND_API_KEY: 'test-key', EMAIL_FROM: 'Wordloom <no-reply@example.com>' } : {}),
        });
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        response = json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status);
      }
      for (const cookie of response.headers.getSetCookie()) {
        const [k, v] = cookie.split(';')[0].split('=');
        if (v) jar.set(k, v);
        else jar.delete(k);
      }
      return { response, value: await response.json() };
    },
  };
}
const pepper = randomUUID();
const password = randomUUID();
const newPassword = randomUUID();
const otherPassword = randomUUID();
const wrongPassword = randomUUID();
// Signs up and opens the confirmation link, which leaves the account signed in.
async function signup(f, name = 'learner') {
  const email = `${name}@example.com`;
  await f.call('account/password/register', { name, email, password });
  return f.call('account/confirm/complete', { token: f.linkToken(email) });
}
test('sign up with name, email and password, then sign in by email or username', async t => {
  const f = fixture(t),
    created = await f.call('account/password/register', {
      name: 'Word Fan',
      email: '  WORD@EXAMPLE.COM ',
      password,
    });
  assert.equal(created.response.status, 200, JSON.stringify(created.value));
  assert.equal(created.value.user, null);
  assert.equal(created.value.confirmEmail, 'word@example.com');
  assert.equal(created.value.emailSent, true);
  assert.equal(created.response.headers.get('Set-Cookie'), null);
  // The right password is told to confirm first; a wrong one gets the usual answer.
  const early = await f.call('account/password/login', { identifier: 'word@example.com', password });
  assert.equal(early.response.status, 403);
  assert.equal(early.value.code, 'unconfirmed');
  assert.equal(
    (await f.call('account/password/login', { identifier: 'word@example.com', password: wrongPassword })).response.status,
    401,
  );
  const confirmed = await f.call('account/confirm/complete', { token: f.linkToken('word@example.com') });
  assert.equal(confirmed.response.status, 200);
  assert.equal(confirmed.value.user.username, 'word');
  assert.equal(confirmed.value.user.emailConfirmed, true);
  assert.match(confirmed.response.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Lax/);
  const row = f.sqlite.prepare('SELECT password_salt,password_hash FROM users').get();
  assert.notEqual(row.password_hash, password);
  await f.call('account/logout', {});
  assert.equal((await f.call('collection')).response.status, 401);
  assert.equal(
    (await f.call('account/password/login', { identifier: 'WORD@EXAMPLE.COM', password })).response.status,
    200,
  );
  await f.call('account/logout', {});
  assert.equal(
    (await f.call('account/password/login', { identifier: 'word', password })).response.status,
    200,
  );
  await f.call('account/logout', {});
  assert.equal(
    (
      await f.call('account/password/login', {
        identifier: 'word@example.com',
        password: wrongPassword,
      })
    ).response.status,
    401,
  );
});
test('sign-up rejects bad input and repeated emails', async t => {
  const f = fixture(t);
  await signup(f, 'taken');
  await f.call('account/logout', {});
  assert.equal(
    (await f.call('account/password/register', { name: 'Copy', email: 'taken@example.com', password }))
      .response.status,
    409,
  );
  assert.equal(
    (await f.call('account/password/register', { name: '', email: 'a@example.com', password })).response
      .status,
    400,
  );
  assert.equal(
    (await f.call('account/password/register', { name: 'A', email: 'not-an-email', password })).response
      .status,
    400,
  );
  assert.equal(
    (await f.call('account/password/register', { name: 'A', email: 'a@example.com', password: randomUUID().slice(0, 5) }))
      .response.status,
    400,
  );
  assert.equal(
    (await f.call('account/password/register', { name: 'A', email: 'a@example.com', password: randomUUID().slice(0, 8) }))
      .response.status,
    200,
  );
});
test('two emails with the same start get different usernames', async t => {
  const f = fixture(t);
  await f.call('account/password/register', { name: 'A', email: 'sam@one.example', password });
  await f.call('account/password/register', { name: 'B', email: 'sam@two.example', password });
  const names = f.sqlite.prepare('SELECT username FROM users ORDER BY created_at, display_name').all().map(r => r.username);
  assert.equal(names[0], 'sam');
  assert.notEqual(names[1], 'sam');
});
test('requests from another site and removed passkey routes are refused', async t => {
  const f = fixture(t);
  assert.equal(
    (
      await f.call('account/password/register', { name: 'A', email: 'a@example.com', password }, 'POST', {
        Origin: 'https://evil.example',
      })
    ).response.status,
    403,
  );
  assert.equal((await f.call('account/login/options', {})).response.status, 404);
  assert.equal((await f.call('account/passkey/options', {})).response.status, 404);
});
test('signed-in user can change their email', async t => {
  const f = fixture(t);
  await signup(f);
  const updated = await f.call('account/contact', { email: 'new@example.com' });
  assert.equal(updated.value.user.email, 'new@example.com');
  assert.equal(updated.value.user.emailConfirmed, false);
  await f.call('account/logout', {});
  assert.equal(
    (await f.call('account/password/login', { identifier: 'new@example.com', password })).response.status,
    403,
  );
  await f.call('account/confirm/complete', { token: f.linkToken('new@example.com') });
  await f.call('account/logout', {});
  assert.equal(
    (await f.call('account/password/login', { identifier: 'new@example.com', password })).response.status,
    200,
  );
});
test('collections are account-isolated, validated and protected from stale overwrites', async t => {
  const f = fixture(t);
  await signup(f, 'first');
  const data = { words: [structuredClone(starterWords[0])], history: [] };
  assert.equal((await f.call('collection', { data, revision: 0 }, 'PUT')).value.revision, 1);
  assert.equal(
    (await f.call('collection', { data: { words: [], history: [] }, revision: 0 }, 'PUT')).response.status,
    409,
  );
  assert.equal((await f.call('collection')).value.data.words.length, 1);
  assert.equal(
    (await f.call('collection', { data: { words: [{ word: 'invalid' }], history: [] }, revision: 1 }, 'PUT'))
      .response.status,
    400,
  );
  await f.call('account/logout', {});
  await signup(f, 'second');
  assert.equal((await f.call('collection')).value.data.words.length, 0);
  assert.equal(
    (await f.call('collection', { data, revision: 0, user_id: 'first' }, 'PUT')).value.revision,
    1,
  );
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM collections WHERE revision=1').get().n, 2);
});
test('email password reset is one-time, expires, and revokes active sessions', async t => {
  const f = fixture(t),
    user = await signup(f, 'reset'),
    oldSession = f.jar.get('__Host-wordloom-session');
  const originalFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    return new Response('{}', { status: 200 });
  };
  try {
    const requested = await f.call('account/password-reset/request', { email: 'reset@example.com' });
    assert.equal(requested.response.status, 200);
    assert.equal(requested.value.ok, true);
    const link = sent.text.match(/https:\/\/wordloom\.example\/\?passwordReset=([A-Za-z0-9_-]{43})/);
    assert.ok(link);
    const token = link[1];
    assert.equal(
      (await f.call('account/password-reset/complete', { token, password: newPassword }))
        .response.status,
      200,
    );
    assert.equal(
      (await f.call('account/me', undefined, 'GET', { Cookie: '__Host-wordloom-session=' + oldSession }))
        .value.user,
      null,
    );
    await f.call('account/logout', {});
    assert.equal(
      (
        await f.call('account/password/login', {
          identifier: 'reset@example.com',
          password: newPassword,
        })
      ).response.status,
      200,
    );
    assert.equal(
      (await f.call('account/password-reset/complete', { token, password: otherPassword }))
        .response.status,
      400,
    );
    assert.equal(
      (await f.call('account/password-reset/request', { email: 'missing@example.com' })).response.status,
      200,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM users').get().n, 1);
  assert.equal('user' in user.value, true);
});

test('a confirmation link works once and a new one replaces it', async t => {
  const f = fixture(t);
  await f.call('account/password/register', { name: 'Once', email: 'once@example.com', password });
  const first = f.linkToken('once@example.com');
  assert.equal((await f.call('account/confirm/resend', { email: 'once@example.com' })).response.status, 200);
  const second = f.linkToken('once@example.com');
  assert.notEqual(first, second);
  assert.equal((await f.call('account/confirm/complete', { token: first })).response.status, 400);
  assert.equal((await f.call('account/confirm/complete', { token: second })).response.status, 200);
  assert.equal((await f.call('account/confirm/complete', { token: second })).response.status, 400);
  // Confirmed accounts and unknown emails get the same answer and no email.
  const count = f.mail.length;
  const known = await f.call('account/confirm/resend', { email: 'once@example.com' });
  const unknown = await f.call('account/confirm/resend', { email: 'nobody@example.com' });
  assert.deepEqual(known.value, unknown.value);
  assert.equal(f.mail.length, count);
});
test('confirmation emails are limited per address', async t => {
  const f = fixture(t);
  await f.call('account/password/register', { name: 'Spam', email: 'spam@example.com', password });
  const statuses = [];
  for (let i = 0; i < 5; i++)
    statuses.push((await f.call('account/confirm/resend', { email: 'spam@example.com' })).response.status);
  assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
});
test('resetting the password also confirms the email', async t => {
  const f = fixture(t);
  await f.call('account/password/register', { name: 'Skip', email: 'skip@example.com', password });
  await f.call('account/password-reset/request', { email: 'skip@example.com' });
  const token = f.linkToken('skip@example.com', 'passwordReset');
  assert.equal((await f.call('account/password-reset/complete', { token, password: newPassword })).response.status, 200);
  assert.equal(
    (await f.call('account/password/login', { identifier: 'skip@example.com', password: newPassword })).response.status,
    200,
  );
});
test('without an email service, new accounts are confirmed and signed in right away', async t => {
  const f = fixture(t, { emailSetUp: false });
  const created = await f.call('account/password/register', { name: 'Local', email: 'local@example.com', password });
  assert.equal(created.value.user.emailConfirmed, true);
  assert.match(created.response.headers.get('Set-Cookie'), /wordloom-session=/);
  assert.equal(f.mail.length, 0);
});
test('accounts made before email confirmation stay confirmed', () => {
  const { sqlite } = database(migrations.slice(0, 3));
  sqlite
    .prepare("INSERT INTO users(id,username,display_name,recovery_hash,created_at,email) VALUES('old','old','Old','x',1,'old@example.com')")
    .run();
  sqlite.exec(readFileSync(new URL('../server/migrations/0004_email_confirmation.sql', import.meta.url), 'utf8'));
  assert.equal(sqlite.prepare('SELECT email_verified FROM users').get().email_verified, 1);
  sqlite.close();
});
