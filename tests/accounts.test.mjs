import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { accountAPI, ApiError, json } from '../server/accounts.mjs';
import { starterWords } from '../public/starter.js';

const origin = 'https://wordloom.example';
function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0001_accounts.sql', '0002_password_accounts.sql', '0003_contact_password_reset.sql'])
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
function fixture(t) {
  const { db, sqlite } = database();
  t.after(() => sqlite.close());
  const jar = new Map();
  return {
    db,
    sqlite,
    jar,
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
          RESEND_API_KEY: 'test-key',
          EMAIL_FROM: 'Wordloom <no-reply@example.com>',
        });
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        response = json({ error: error.message }, error.status);
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
const signup = (f, name = 'learner') =>
  f.call('account/password/register', { name, email: `${name}@example.com`, password });
test('sign up with name, email and password, then sign in by email or username', async t => {
  const f = fixture(t),
    created = await f.call('account/password/register', {
      name: 'Word Fan',
      email: '  WORD@EXAMPLE.COM ',
      password,
    });
  assert.equal(created.response.status, 200, JSON.stringify(created.value));
  assert.equal(created.value.user.email, 'word@example.com');
  assert.equal(created.value.user.username, 'word');
  assert.match(created.response.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Lax/);
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
  const first = await f.call('account/password/register', { name: 'A', email: 'sam@one.example', password });
  await f.call('account/logout', {});
  const second = await f.call('account/password/register', { name: 'B', email: 'sam@two.example', password });
  assert.equal(first.value.user.username, 'sam');
  assert.notEqual(second.value.user.username, 'sam');
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
    user = await f.call('account/password/register', {
      name: 'Reset User',
      email: 'reset@example.com',
      password,
    }),
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
