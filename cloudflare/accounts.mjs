import {generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse} from '@simplewebauthn/server';
import {validWord, safeWord} from '../public/learning.js';

const SESSION = '__Host-wordloom-session';
const CHALLENGE = '__Host-wordloom-challenge';
const SESSION_SECONDS = 60 * 60 * 24 * 14;
const PASSWORD_ITERATIONS = 600_000;
export class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const json = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), {status, headers: {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff', ...extra}});
export function encode(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
const decode = value => Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
const random = () => encode(crypto.getRandomValues(new Uint8Array(32)));
const randomSalt = () => encode(crypto.getRandomValues(new Uint8Array(16)));
async function passwordHash(password,salt,pepper) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(`${pepper}\0${password}`),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:decode(salt),iterations:PASSWORD_ITERATIONS},key,256);
  return encode(new Uint8Array(bits));
}
function validPassword(password) { return typeof password==='string'&&password.length>=12&&password.length<=128; }
function normalizedEmail(value) {
  if(value===undefined||value===null||value==='')return null;
  if(typeof value!=='string')throw new ApiError(400,'Enter a valid email address or leave it blank.');
  const email=value.trim().toLowerCase();
  if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new ApiError(400,'Enter a valid email address or leave it blank.');
  return email;
}
function sameHash(a,b) { if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0; }
export async function digest(value) { return encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))); }
function cookie(request, name) { return request.headers.get('Cookie')?.split(';').map(c=>c.trim()).find(c=>c.startsWith(name+'='))?.slice(name.length+1) || ''; }
const setCookie = (name, value, seconds) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
const publicUser = row => ({id:row.id, username:row.username, name:row.display_name});

export async function readJSON(request, max = 262144) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new ApiError(415,'Send JSON.');
  if (Number(request.headers.get('Content-Length')) > max) throw new ApiError(413,'This request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400,'A request body is required.');
  const chunks=[]; let size=0;
  for (;;) { const {done,value}=await reader.read(); if(done)break; size+=value.length; if(size>max){await reader.cancel();throw new ApiError(413,'This request is too large.');}chunks.push(value); }
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try { const value=JSON.parse(new TextDecoder().decode(bytes)); if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value; } catch { throw new ApiError(400,'Invalid JSON.'); }
}
export function cleanCollection(value) {
  if(!value||!Array.isArray(value.words)||!Array.isArray(value.history)||value.words.length>5000||value.history.length>20000||!value.words.every(validWord))throw new ApiError(400,'Invalid collection. Use up to 5,000 words and 20,000 reviews.');
  const words=value.words.map(safeWord);
  if(new Set(words.map(w=>w.id)).size!==words.length)throw new ApiError(400,'Each word needs a unique ID.');
  const history=value.history.map(h=>{
    if(!h||!Number.isFinite(h.at)||typeof h.word!=='string'||h.word.length>80||!['again','hard','good','easy'].includes(h.rating)||!['flash','quiz','sentence','cloze'].includes(h.mode))throw new ApiError(400,'Invalid review history.');
    return {at:h.at,word:h.word,rating:h.rating,mode:h.mode};
  });
  return {words,history};
}
async function limit(db, bucket, max, period) {
  const now=Date.now();
  const row=await db.prepare('INSERT INTO rate_limits(bucket,attempts,reset_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END, reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING attempts,reset_at').bind(bucket,now+period,now,now).first();
  if(row.attempts>max)throw new ApiError(429,'Too many attempts. Wait a few minutes and try again.');
}
export async function currentSession(request, db) {
  const token=cookie(request,SESSION);
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
  return db.prepare('SELECT users.*,sessions.token_hash FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?').bind(await digest(token),Date.now()).first();
}
async function requireUser(request,db) { const row=await currentSession(request,db);if(!row)throw new ApiError(401,'Please sign in again. Your unsaved words are still on this device.');return row; }
async function newSession(db,user) {
  const token=random();
  return {token,statement:db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await digest(token),user.id,Date.now()+SESSION_SECONDS*1000)};
}
async function challengeResponse(db,options,ceremony,user={}) {
  const token=random(), now=Date.now();
  await db.batch([
    db.prepare('DELETE FROM challenges WHERE token_hash IN (SELECT token_hash FROM challenges WHERE expires_at<=? LIMIT 100)').bind(now),
    db.prepare('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at<=? LIMIT 100)').bind(now),
    db.prepare('DELETE FROM rate_limits WHERE bucket IN (SELECT bucket FROM rate_limits WHERE reset_at<=? LIMIT 100)').bind(now),
    db.prepare('INSERT INTO challenges(token_hash,challenge,ceremony,user_id,username,display_name,expires_at) VALUES(?,?,?,?,?,?,?)').bind(await digest(token),options.challenge,ceremony,user.id||null,user.username||null,user.display_name||null,now+300000),
  ]);
  return json({options},200,{'Set-Cookie':setCookie(CHALLENGE,token,300)});
}
async function consumeChallenge(request, db, ceremony) {
  const row=await db.prepare('DELETE FROM challenges WHERE token_hash=? RETURNING *').bind(await digest(cookie(request,CHALLENGE))).first();
  if(!row||row.ceremony!==ceremony||row.expires_at<=Date.now())throw new ApiError(400,'This sign-in attempt expired. Start again.');
  return row;
}
async function checkedVerification(call) { try { const result=await call(); if(!result.verified)throw Error();return result; } catch { throw new ApiError(400,'The passkey could not be verified. Please try again.'); } }

export async function accountAPI(request, env) {
  const path=new URL(request.url).pathname;
  const methods={'/api/account/me':'GET','/api/account/password/register':'POST','/api/account/password/login':'POST','/api/account/register/options':'POST','/api/account/register/verify':'POST','/api/account/login/options':'POST','/api/account/login/verify':'POST','/api/account/recover':'POST','/api/account/logout':'POST','/api/account/passkey/options':'POST','/api/account/passkey/verify':'POST','/api/account/recovery':'POST','/api/collection':'GET, PUT'};
  if(!methods[path])return json({error:'API route not found.'},404);
  if(!methods[path].split(', ').includes(request.method))return json({error:'Method not allowed.'},405,{Allow:methods[path]});
  const db=env.DB;
  if(!db)return json({error:'Accounts are not configured on this server. You can keep practicing as a guest.'},503);
  const origin=env.APP_ORIGIN;
  if(!origin||new URL(request.url).origin!==origin)throw new ApiError(403,'Use the Wordloom app to access your account.');
  if(request.method!=='GET'&&request.headers.get('Origin')!==origin)throw new ApiError(403,'This request must come from Wordloom.');
  const rpID=new URL(origin).hostname;
  const ip=await digest(request.headers.get('CF-Connecting-IP')||'local');
  if(path==='/api/account/me') {const user=await currentSession(request,db);return json({user:user?publicUser(user):null});}
  if(path==='/api/collection') {
    const user=await requireUser(request,db);
    await limit(db,'collection:'+user.id,120,60000);
    if(request.method==='GET') {
      const row=await db.prepare('SELECT data,revision FROM collections WHERE user_id=?').bind(user.id).first();
      return json({data:JSON.parse(row.data),revision:row.revision});
    }
    const body=await readJSON(request,2000000),data=cleanCollection(body.data);
    if(!Number.isSafeInteger(body.revision)||body.revision<0)throw new ApiError(400,'Invalid collection revision.');
    const result=await db.prepare('UPDATE collections SET data=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=? RETURNING revision').bind(JSON.stringify(data),Date.now(),user.id,body.revision).first();
    if(!result)throw new ApiError(409,'Your collection changed on another device. Choose which version to keep.');
    return json({revision:result.revision});
  }
  if(path==='/api/account/logout') {
    const user=await currentSession(request,db);
    if(user)await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(user.token_hash).run();
    return json({ok:true},200,{'Set-Cookie':setCookie(SESSION,'',0)});
  }
  await limit(db,'auth:'+ip,40,600000);
  const body=await readJSON(request);
  if(path==='/api/account/password/register') {
    const username=typeof body.username==='string'?body.username.trim().toLowerCase():'';
    const name=typeof body.name==='string'?body.name.trim():'';
    const email=normalizedEmail(body.email);
    if(!/^[a-z0-9_]{3,24}$/.test(username)||name.length<1||name.length>50)throw new ApiError(400,'Use a name up to 50 characters and a username with 3–24 letters, numbers, or underscores.');
    if(!validPassword(body.password))throw new ApiError(400,'Use a password between 12 and 128 characters.');
    if(await db.prepare('SELECT id FROM users WHERE username=? OR (? IS NOT NULL AND email=?)').bind(username,email,email).first())throw new ApiError(409,'That username or email is already registered.');
    const user={id:crypto.randomUUID(),username,display_name:name},salt=randomSalt(),recoveryCode=random(),fresh=await newSession(db,user);
    try {await db.batch([
      db.prepare('INSERT INTO users(id,username,display_name,recovery_hash,created_at,email,password_salt,password_hash) VALUES(?,?,?,?,?,?,?,?)').bind(user.id,username,name,await digest(recoveryCode),Date.now(),email,salt,await passwordHash(body.password,salt,env.PASSWORD_PEPPER||'')),
      db.prepare('INSERT INTO collections(user_id,updated_at) VALUES(?,?)').bind(user.id,Date.now()),fresh.statement,
    ]);}catch(error){if(String(error.message).includes('UNIQUE'))throw new ApiError(409,'That username or email is already registered.');throw error;}
    return json({user:publicUser(user),recoveryCode},200,{'Set-Cookie':setCookie(SESSION,fresh.token,SESSION_SECONDS)});
  }
  if(path==='/api/account/password/login') {
    const identifier=typeof body.identifier==='string'?body.identifier.trim().toLowerCase():'';
    if(identifier.length>254||!validPassword(body.password))throw new ApiError(401,'Username/email or password is incorrect.');
    await limit(db,'password:'+await digest(identifier),10,900000);
    const user=await db.prepare('SELECT * FROM users WHERE username=? OR email=?').bind(identifier,identifier).first();
    const salt=user?.password_salt||randomSalt(),actual=await passwordHash(body.password,salt,env.PASSWORD_PEPPER||'');
    if(!user?.password_hash||!sameHash(actual,user.password_hash))throw new ApiError(401,'Username/email or password is incorrect.');
    const fresh=await newSession(db,user);await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await digest(fresh.token),user.id,Date.now()+SESSION_SECONDS*1000).run();
    return json({user:publicUser(user)},200,{'Set-Cookie':setCookie(SESSION,fresh.token,SESSION_SECONDS)});
  }
  if(path==='/api/account/register/options'||path==='/api/account/passkey/options') {
    let user,ceremony='register',excludeCredentials=[];
    if(path.includes('/passkey/')) {
      user=await requireUser(request,db);ceremony='passkey';
      const {results}=await db.prepare('SELECT id,transports FROM credentials WHERE user_id=?').bind(user.id).all();
      if(results.length>=10)throw new ApiError(400,'You already have 10 passkeys.');
      excludeCredentials=results.map(c=>({id:c.id,transports:JSON.parse(c.transports)}));
    } else {
      const username=typeof body.username==='string'?body.username.trim().toLowerCase():'';
      const name=typeof body.name==='string'?body.name.trim():'';
      if(!/^[a-z0-9_]{3,24}$/.test(username)||name.length<1||name.length>50)throw new ApiError(400,'Use a name up to 50 characters and a username with 3–24 letters, numbers, or underscores.');
      if(await db.prepare('SELECT id FROM users WHERE username=?').bind(username).first())throw new ApiError(409,'That username is taken. Choose another.');
      user={id:crypto.randomUUID(),username,display_name:name};
    }
    const options=await generateRegistrationOptions({rpName:'Wordloom',rpID,userID:new TextEncoder().encode(user.id),userName:user.username,userDisplayName:user.display_name,attestationType:'none',supportedAlgorithmIDs:[-7,-257],authenticatorSelection:{residentKey:'required',userVerification:'required'},excludeCredentials});
    return challengeResponse(db,options,ceremony,user);
  }
  if(path==='/api/account/register/verify'||path==='/api/account/passkey/verify') {
    const adding=path.includes('/passkey/'),challenge=await consumeChallenge(request,db,adding?'passkey':'register');
    if(adding&&(await requireUser(request,db)).id!==challenge.user_id)throw new ApiError(403,'Start again from your account.');
    const {registrationInfo}=await checkedVerification(()=>verifyRegistrationResponse({response:body.credential,expectedChallenge:challenge.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true}));
    const credential=registrationInfo.credential,user={id:challenge.user_id,username:challenge.username,display_name:challenge.display_name};
    const statements=[],recoveryCode=adding?null:random();
    if(!adding) {
      statements.push(db.prepare('INSERT INTO users(id,username,display_name,recovery_hash,created_at) VALUES(?,?,?,?,?)').bind(user.id,user.username,user.display_name,await digest(recoveryCode),Date.now()));
      statements.push(db.prepare('INSERT INTO collections(user_id,updated_at) VALUES(?,?)').bind(user.id,Date.now()));
    }
    statements.push(db.prepare('INSERT INTO credentials(id,user_id,public_key,counter,transports) VALUES(?,?,?,?,?)').bind(credential.id,user.id,encode(credential.publicKey),credential.counter,JSON.stringify(credential.transports||[])));
    if(adding){await db.batch(statements);return json({ok:true});}
    const fresh=await newSession(db,user);statements.push(fresh.statement);
    try {await db.batch(statements);}catch(error){if(String(error.message).includes('UNIQUE'))throw new ApiError(409,'That username or passkey is already registered. Please sign in or choose another username.');throw error;}
    return json({user:publicUser(user),recoveryCode},200,{'Set-Cookie':setCookie(SESSION,fresh.token,SESSION_SECONDS)});
  }
  if(path==='/api/account/login/options')return challengeResponse(db,await generateAuthenticationOptions({rpID,userVerification:'required'}),'login');
  if(path==='/api/account/login/verify') {
    const challenge=await consumeChallenge(request,db,'login');
    if(typeof body.credential?.id!=='string')throw new ApiError(400,'Choose a passkey.');
    const credential=await db.prepare('SELECT credentials.*,users.username,users.display_name FROM credentials JOIN users ON users.id=credentials.user_id WHERE credentials.id=?').bind(body.credential.id).first();
    if(!credential)throw new ApiError(400,'This passkey is not registered with Wordloom.');
    const {authenticationInfo}=await checkedVerification(()=>verifyAuthenticationResponse({response:body.credential,expectedChallenge:challenge.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true,credential:{id:credential.id,publicKey:decode(credential.public_key),counter:credential.counter,transports:JSON.parse(credential.transports)}}));
    if(body.credential.response?.userHandle!==encode(new TextEncoder().encode(credential.user_id)))throw new ApiError(400,'This passkey does not match the account.');
    const user={...credential,id:credential.user_id},fresh=await newSession(db,user);
    await db.batch([db.prepare('UPDATE credentials SET counter=MAX(counter,?) WHERE id=?').bind(authenticationInfo.newCounter,credential.id),fresh.statement]);
    return json({user:publicUser(user)},200,{'Set-Cookie':setCookie(SESSION,fresh.token,SESSION_SECONDS)});
  }
  if(path==='/api/account/recover') {
    await limit(db,'recover:'+ip,5,900000);
    const username=typeof body.username==='string'?body.username.trim().toLowerCase():'';
    const code=typeof body.code==='string'?body.code.trim():'';
    if(!/^[A-Za-z0-9_-]{43}$/.test(code))throw new ApiError(401,'The username or recovery code is incorrect.');
    const codeHash=await digest(code);
    const user=await db.prepare('SELECT * FROM users WHERE username=? AND recovery_hash=?').bind(username,codeHash).first();
    if(!user)throw new ApiError(401,'The username or recovery code is incorrect.');
    const recoveryCode=random(),fresh=await newSession(db,user);
    // Compare-and-swap makes recovery codes single-use even for concurrent requests.
    const result=await db.prepare('UPDATE users SET recovery_hash=? WHERE id=? AND recovery_hash=? RETURNING id').bind(await digest(recoveryCode),user.id,codeHash).first();
    if(!result)throw new ApiError(401,'That recovery code has already been used.');
    await db.batch([db.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id),fresh.statement]);
    return json({user:publicUser(user),recoveryCode},200,{'Set-Cookie':setCookie(SESSION,fresh.token,SESSION_SECONDS)});
  }
  if(path==='/api/account/recovery') {
    const user=await requireUser(request,db),recoveryCode=random();
    await db.prepare('UPDATE users SET recovery_hash=? WHERE id=?').bind(await digest(recoveryCode),user.id).run();
    return json({recoveryCode});
  }
}
