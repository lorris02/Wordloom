import { validWord, safeWord } from '../public/learning.js';

const SESSION = '__Host-wordloom-session';
const SESSION_SECONDS = 60 * 60 * 24 * 14;
const PASSWORD_ITERATIONS = 600_000;
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const json = (value, status = 200, extra = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    },
  });
export function encode(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
const decode = value =>
  Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const random = () => encode(crypto.getRandomValues(new Uint8Array(32)));
const randomSalt = () => encode(crypto.getRandomValues(new Uint8Array(16)));
async function passwordHash(password, salt, pepper) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${pepper}\0${password}`),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: decode(salt), iterations: PASSWORD_ITERATIONS },
    key,
    256,
  );
  return encode(new Uint8Array(bits));
}
function validPassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 128;
}
function normalizedEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new ApiError(400, 'Enter a valid email address.');
  return email;
}
// Accounts keep a unique username internally, so sign-up only needs an email.
async function freeUsername(db, email) {
  const base = email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 18)
    .padEnd(3, '0');
  for (let attempt = 0; attempt < 6; attempt++) {
    const username = attempt === 0 ? base : `${base}${crypto.getRandomValues(new Uint16Array(1))[0]}`;
    if (!(await db.prepare('SELECT id FROM users WHERE username=?').bind(username).first())) return username;
  }
  throw new ApiError(409, 'Could not create that account. Please try again.');
}
async function sendReset(env, email, link) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM)
    throw new ApiError(503, 'Password reset emails are not set up yet.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [email],
      subject: 'Reset your Wordloom password',
      text: `Reset your Wordloom password: ${link}\n\nThis link expires in 30 minutes. If you did not ask for it, you can ignore this email.`,
    }),
  });
  if (!response.ok)
    throw new ApiError(502, 'We could not send the reset email. Check the address and try again.');
}
function sameHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
export async function digest(value) {
  return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}
function cookie(request, name) {
  return (
    request.headers
      .get('Cookie')
      ?.split(';')
      .map(c => c.trim())
      .find(c => c.startsWith(name + '='))
      ?.slice(name.length + 1) || ''
  );
}
const setCookie = (name, value, seconds) =>
  `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
const publicUser = row => ({
  id: row.id,
  username: row.username,
  name: row.display_name,
  email: row.email || null,
});

export async function readJSON(request, max = 262144) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))
    throw new ApiError(415, 'Send JSON.');
  if (Number(request.headers.get('Content-Length')) > max)
    throw new ApiError(413, 'This request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'A request body is required.');
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new ApiError(413, 'This request is too large.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    return value;
  } catch {
    throw new ApiError(400, 'Invalid JSON.');
  }
}
export function cleanCollection(value) {
  if (
    !value ||
    !Array.isArray(value.words) ||
    !Array.isArray(value.history) ||
    value.words.length > 5000 ||
    value.history.length > 20000 ||
    !value.words.every(validWord)
  )
    throw new ApiError(400, 'Invalid collection. Use up to 5,000 words and 20,000 reviews.');
  const words = value.words.map(safeWord);
  if (new Set(words.map(w => w.id)).size !== words.length)
    throw new ApiError(400, 'Each word needs a unique ID.');
  const history = value.history.map(h => {
    if (
      !h ||
      !Number.isFinite(h.at) ||
      typeof h.word !== 'string' ||
      h.word.length > 80 ||
      !['again', 'hard', 'good', 'easy'].includes(h.rating) ||
      !['flash', 'quiz', 'sentence', 'cloze'].includes(h.mode)
    )
      throw new ApiError(400, 'Invalid review history.');
    return { at: h.at, word: h.word, rating: h.rating, mode: h.mode };
  });
  return { words, history };
}
async function limit(db, bucket, max, period) {
  const now = Date.now();
  const row = await db
    .prepare(
      'INSERT INTO rate_limits(bucket,attempts,reset_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END, reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING attempts,reset_at',
    )
    .bind(bucket, now + period, now, now)
    .first();
  if (row.attempts > max) throw new ApiError(429, 'Too many attempts. Wait a few minutes and try again.');
}
export async function currentSession(request, db) {
  const token = cookie(request, SESSION);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return db
    .prepare(
      'SELECT users.*,sessions.token_hash FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?',
    )
    .bind(await digest(token), Date.now())
    .first();
}
async function requireUser(request, db) {
  const row = await currentSession(request, db);
  if (!row) throw new ApiError(401, 'Please sign in again. Your unsaved words are still on this device.');
  return row;
}
async function newSession(db, user) {
  const token = random();
  return {
    token,
    statement: db
      .prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)')
      .bind(await digest(token), user.id, Date.now() + SESSION_SECONDS * 1000),
  };
}
export async function accountAPI(request, env) {
  const path = new URL(request.url).pathname;
  const methods = {
    '/api/account/me': 'GET',
    '/api/account/password/register': 'POST',
    '/api/account/password/login': 'POST',
    '/api/account/password-reset/request': 'POST',
    '/api/account/password-reset/complete': 'POST',
    '/api/account/contact': 'POST',
    '/api/account/logout': 'POST',
    '/api/collection': 'GET, PUT',
  };
  if (!methods[path]) return json({ error: 'API route not found.' }, 404);
  if (!methods[path].split(', ').includes(request.method))
    return json({ error: 'Method not allowed.' }, 405, { Allow: methods[path] });
  const db = env.DB;
  if (!db)
    return json(
      { error: 'Accounts are not configured on this server. You can keep practicing as a guest.' },
      503,
    );
  const origin = env.APP_ORIGIN;
  if (!origin || new URL(request.url).origin !== origin)
    throw new ApiError(403, 'Use the Wordloom app to access your account.');
  if (request.method !== 'GET' && request.headers.get('Origin') !== origin)
    throw new ApiError(403, 'This request must come from Wordloom.');
  const ip = await digest(request.headers.get('X-Client-IP') || 'local');
  if (path === '/api/account/me') {
    const user = await currentSession(request, db);
    return json({ user: user ? publicUser(user) : null });
  }
  if (path === '/api/collection') {
    const user = await requireUser(request, db);
    await limit(db, 'collection:' + user.id, 120, 60000);
    if (request.method === 'GET') {
      const row = await db
        .prepare('SELECT data,revision FROM collections WHERE user_id=?')
        .bind(user.id)
        .first();
      return json({ data: JSON.parse(row.data), revision: row.revision });
    }
    const body = await readJSON(request, 2000000),
      data = cleanCollection(body.data);
    if (!Number.isSafeInteger(body.revision) || body.revision < 0)
      throw new ApiError(400, 'Invalid collection revision.');
    const result = await db
      .prepare(
        'UPDATE collections SET data=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=? RETURNING revision',
      )
      .bind(JSON.stringify(data), Date.now(), user.id, body.revision)
      .first();
    if (!result)
      throw new ApiError(409, 'Your collection changed on another device. Choose which version to keep.');
    return json({ revision: result.revision });
  }
  if (path === '/api/account/logout') {
    const user = await currentSession(request, db);
    if (user) await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(user.token_hash).run();
    return json({ ok: true }, 200, { 'Set-Cookie': setCookie(SESSION, '', 0) });
  }
  await limit(db, 'auth:' + ip, 40, 600000);
  const body = await readJSON(request);
  if (path === '/api/account/contact') {
    const account = await requireUser(request, db),
      email = normalizedEmail(body.email);
    if (await db.prepare('SELECT id FROM users WHERE id<>? AND email=?').bind(account.id, email).first())
      throw new ApiError(409, 'That email is already linked to another account.');
    try {
      await db.prepare('UPDATE users SET email=? WHERE id=?').bind(email, account.id).run();
    } catch (error) {
      if (String(error.message).includes('UNIQUE'))
        throw new ApiError(409, 'That email is already linked to another account.');
      throw error;
    }
    return json({ user: publicUser({ ...account, email }) });
  }
  if (path === '/api/account/password/register') {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = normalizedEmail(body.email);
    if (name.length < 1 || name.length > 50) throw new ApiError(400, 'Enter your name, up to 50 characters.');
    if (!validPassword(body.password))
      throw new ApiError(400, 'Use a password between 8 and 128 characters.');
    if (await db.prepare('SELECT id FROM users WHERE email=?').bind(email).first())
      throw new ApiError(409, 'That email already has an account. Try signing in.');
    const username = await freeUsername(db, email);
    const user = { id: crypto.randomUUID(), username, display_name: name, email },
      salt = randomSalt(),
      fresh = await newSession(db, user);
    try {
      await db.batch([
        db
          .prepare(
            'INSERT INTO users(id,username,display_name,recovery_hash,created_at,email,password_salt,password_hash) VALUES(?,?,?,?,?,?,?,?)',
          )
          .bind(
            user.id,
            username,
            name,
            await digest(random()),
            Date.now(),
            email,
            salt,
            await passwordHash(body.password, salt, env.PASSWORD_PEPPER || ''),
          ),
        db.prepare('INSERT INTO collections(user_id,updated_at) VALUES(?,?)').bind(user.id, Date.now()),
        fresh.statement,
      ]);
    } catch (error) {
      if (String(error.message).includes('UNIQUE'))
        throw new ApiError(409, 'That email already has an account. Try signing in.');
      throw error;
    }
    return json({ user: publicUser(user) }, 200, {
      'Set-Cookie': setCookie(SESSION, fresh.token, SESSION_SECONDS),
    });
  }
  if (path === '/api/account/password/login') {
    const identifier = typeof body.identifier === 'string' ? body.identifier.trim().toLowerCase() : '';
    if (identifier.length > 254 || !validPassword(body.password))
      throw new ApiError(401, 'Email or password is incorrect.');
    await limit(db, 'password:' + (await digest(identifier)), 10, 900000);
    const user = await db
      .prepare('SELECT * FROM users WHERE username=? OR email=?')
      .bind(identifier, identifier)
      .first();
    const salt = user?.password_salt || randomSalt(),
      actual = await passwordHash(body.password, salt, env.PASSWORD_PEPPER || '');
    if (!user?.password_hash || !sameHash(actual, user.password_hash))
      throw new ApiError(401, 'Email or password is incorrect.');
    const fresh = await newSession(db, user);
    await db
      .prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)')
      .bind(await digest(fresh.token), user.id, Date.now() + SESSION_SECONDS * 1000)
      .run();
    return json({ user: publicUser(user) }, 200, {
      'Set-Cookie': setCookie(SESSION, fresh.token, SESSION_SECONDS),
    });
  }
  if (path === '/api/account/password-reset/request') {
    await limit(db, 'reset-ip:' + ip, 10, 900000);
    const email = normalizedEmail(typeof body.email === 'string' ? body.email : '');
    await limit(db, 'reset-contact:' + (await digest(email)), 5, 3600000);
    // Check email setup before looking up the account so missing setup reveals nothing about accounts.
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM)
      throw new ApiError(503, 'Password reset emails are not set up yet.');
    const user = await db.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
    if (user) {
      const token = random(),
        expires = Date.now() + 1800000,
        link = `${origin}/?passwordReset=${token}`;
      await db.prepare('DELETE FROM password_resets WHERE user_id=?').bind(user.id).run();
      await db
        .prepare('INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES(?,?,?)')
        .bind(await digest(token), user.id, expires)
        .run();
      try {
        await sendReset(env, email, link);
      } catch (error) {
        await db.prepare('DELETE FROM password_resets WHERE user_id=?').bind(user.id).run();
        throw error;
      }
    }
    return json({ ok: true, message: 'If that email has an account, a reset link is on the way.' });
  }
  if (path === '/api/account/password-reset/complete') {
    const token = typeof body.token === 'string' ? body.token : '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !validPassword(body.password))
      throw new ApiError(400, 'This reset link is invalid or expired. Request a new one.');
    const row = await db
      .prepare('DELETE FROM password_resets WHERE token_hash=? AND expires_at>? RETURNING user_id')
      .bind(await digest(token), Date.now())
      .first();
    if (!row) throw new ApiError(400, 'This reset link is invalid or expired. Request a new one.');
    const salt = randomSalt(),
      hash = await passwordHash(body.password, salt, env.PASSWORD_PEPPER || '');
    await db.batch([
      db.prepare('UPDATE users SET password_salt=?,password_hash=? WHERE id=?').bind(salt, hash, row.user_id),
      db.prepare('DELETE FROM sessions WHERE user_id=?').bind(row.user_id),
    ]);
    return json({ ok: true });
  }
}
