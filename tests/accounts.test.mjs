import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,sign,createHash,randomBytes} from 'node:crypto';
import {isoCBOR} from '@simplewebauthn/server/helpers';
import {createWorker} from '../cloudflare/worker.mjs';
import {starterWords} from '../public/starter.js';

const origin='https://wordloom.example',rpID='wordloom.example';
function database(){
  const sqlite=new DatabaseSync(':memory:');for(const file of ['0001_accounts.sql','0002_password_accounts.sql'])sqlite.exec(readFileSync(new URL('../cloudflare/migrations/'+file,import.meta.url),'utf8'));
  const db={prepare(sql){const statement=sqlite.prepare(sql);let args=[];return {bind(...values){args=values;return this;},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){return {meta:statement.run(...args)};}};},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  return {db,sqlite};
}
function fixture(t){const {db,sqlite}=database();t.after(()=>sqlite.close());const worker=createWorker({}),jar=new Map();return {db,sqlite,jar,async call(path,body,method=body===undefined?'GET':'POST',extra={}){const headers={'Origin':origin,'CF-Connecting-IP':'192.0.2.1','Cookie':[...jar].map(([k,v])=>k+'='+v).join('; '),...extra};if(body!==undefined)headers['Content-Type']='application/json';const response=await worker.fetch(new Request(origin+'/api/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),{DB:db,APP_ORIGIN:origin,PASSWORD_PEPPER:'test-only-pepper'});for(const cookie of response.headers.getSetCookie()){const [k,v]=cookie.split(';')[0].split('=');if(v)jar.set(k,v);else jar.delete(k);}return {response,value:await response.json()};}};}
const b64=value=>Buffer.from(value).toString('base64url');
test('username/password registration and username or email sign-in',async t=>{
  const f=fixture(t),created=await f.call('account/password/register',{username:'wordfan',name:'Word Fan',email:'  WORD@EXAMPLE.COM ',password:'long secure test phrase'});
  assert.equal(created.response.status,200,JSON.stringify(created.value));assert.equal(created.value.user.username,'wordfan');assert.equal(created.value.recoveryCode.length,43);
  const row=f.sqlite.prepare('SELECT email,password_salt,password_hash,recovery_hash FROM users').get();assert.equal(row.email,'word@example.com');assert.notEqual(row.password_hash,'long secure test phrase');assert.equal(row.password_salt.length,22);
  await f.call('account/logout',{});
  assert.equal((await f.call('account/password/login',{identifier:'WORD@EXAMPLE.COM',password:'long secure test phrase'})).response.status,200);
  await f.call('account/logout',{});
  assert.equal((await f.call('account/password/login',{identifier:'wordfan',password:'wrong password here'})).response.status,401);
  assert.equal((await f.call('account/password/register',{username:'wordfan',name:'Other',password:'another secure phrase'})).response.status,409);
  assert.equal((await f.call('account/password/register',{username:'short',name:'Short',password:'tiny'})).response.status,400);
});
function authenticator(){
  const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=publicKey.export({format:'jwk'}),id=randomBytes(32),hash=createHash('sha256').update(rpID).digest();
  const cose=isoCBOR.encode(new Map([[1,2],[3,-7],[-1,1],[-2,new Uint8Array(Buffer.from(jwk.x,'base64url'))],[-3,new Uint8Array(Buffer.from(jwk.y,'base64url'))]]));
  return {id:b64(id),register(options,{badOrigin=false,verified=true}={}){this.userHandle=options.user.id;const client=Buffer.from(JSON.stringify({type:'webauthn.create',challenge:options.challenge,origin:badOrigin?'https://evil.example':origin,crossOrigin:false}));const authData=Buffer.concat([hash,Buffer.from([verified?0x45:0x41]),Buffer.alloc(4),Buffer.alloc(16),Buffer.from([0,id.length]),id,cose]);return {id:b64(id),rawId:b64(id),type:'public-key',response:{clientDataJSON:b64(client),attestationObject:b64(isoCBOR.encode(new Map([['fmt','none'],['authData',new Uint8Array(authData)],['attStmt',new Map()]]))),transports:['internal']},clientExtensionResults:{}};},login(options,{counter=1,tamper=false}={}){const client=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:options.challenge,origin,crossOrigin:false})),count=Buffer.alloc(4);count.writeUInt32BE(counter);const authData=Buffer.concat([hash,Buffer.from([0x05]),count]),signed=Buffer.concat([authData,createHash('sha256').update(client).digest()]);const signature=sign('sha256',signed,privateKey);if(tamper)signature[signature.length-1]^=1;return {id:b64(id),rawId:b64(id),type:'public-key',response:{clientDataJSON:b64(client),authenticatorData:b64(authData),signature:b64(signature),userHandle:this.userHandle},clientExtensionResults:{}};}};
}
async function signup(f,username='learner',auth=authenticator()) {const options=await f.call('account/register/options',{name:'Learner',username});assert.equal(options.response.status,200);const result=await f.call('account/register/verify',{credential:auth.register(options.value.options)});assert.equal(result.response.status,200,JSON.stringify(result.value));return {...result.value,auth};}

test('real passkey registration, signed login, logout, and replay protection',async t=>{
  const f=fixture(t),registered=await signup(f);
  assert.equal(registered.recoveryCode.length,43);assert.match(f.jar.get('__Host-wordloom-session'),/^[\w-]{43}$/);
  assert.equal((await f.call('account/me')).value.user.username,'learner');
  const row=f.sqlite.prepare('SELECT * FROM users').get();assert.notEqual(row.recovery_hash,registered.recoveryCode);
  assert.equal((await f.call('account/logout',{})).response.status,200);assert.equal((await f.call('collection')).response.status,401);
  const options=await f.call('account/login/options',{}),credential=registered.auth.login(options.value.options);
  const result=await f.call('account/login/verify',{credential});assert.equal(result.response.status,200,JSON.stringify(result.value));
  assert.match(result.response.headers.get('Set-Cookie'),/HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await f.call('account/login/verify',{credential})).response.status,400);
  f.sqlite.prepare('UPDATE sessions SET expires_at=0').run();assert.equal((await f.call('collection')).response.status,401);
});
test('rejects wrong origin, missing device verification, forged signatures, expired challenges and CSRF',async t=>{
  const f=fixture(t),auth=authenticator();
  assert.equal((await f.call('account/register/options',{name:'Learner',username:'learner'},'POST',{Origin:'https://evil.example'})).response.status,403);
  for(const bad of [{badOrigin:true},{verified:false}]){const options=await f.call('account/register/options',{name:'Learner',username:'learner'});assert.equal((await f.call('account/register/verify',{credential:auth.register(options.value.options,bad)})).response.status,400);}
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM users').get().n,0);
  const user=await signup(f,'learner',auth);await f.call('account/logout',{});
  let options=await f.call('account/login/options',{});assert.equal((await f.call('account/login/verify',{credential:user.auth.login(options.value.options,{tamper:true})})).response.status,400);
  options=await f.call('account/login/options',{});f.sqlite.prepare('UPDATE challenges SET expires_at=0').run();assert.equal((await f.call('account/login/verify',{credential:user.auth.login(options.value.options)})).response.status,400);
});
test('collections are account-isolated, validated and protected from stale overwrites',async t=>{
  const f=fixture(t);await signup(f,'first');
  const data={words:[structuredClone(starterWords[0])],history:[]};
  assert.equal((await f.call('collection',{data,revision:0},'PUT')).value.revision,1);
  assert.equal((await f.call('collection',{data:{words:[],history:[]},revision:0},'PUT')).response.status,409);
  assert.equal((await f.call('collection')).value.data.words.length,1);
  assert.equal((await f.call('collection',{data:{words:[{word:'invalid'}],history:[]},revision:1},'PUT')).response.status,400);
  await f.call('account/logout',{});await signup(f,'second');assert.equal((await f.call('collection')).value.data.words.length,0);
  assert.equal((await f.call('collection',{data,revision:0,user_id:'first'},'PUT')).value.revision,1);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM collections WHERE revision=1').get().n,2);
});
test('recovery code is single-use, rotates, revokes old sessions and rejects brute force',async t=>{
  const f=fixture(t),user=await signup(f),oldSession=f.jar.get('__Host-wordloom-session');await f.call('account/logout',{});
  const recovered=await f.call('account/recover',{username:'learner',code:user.recoveryCode});assert.equal(recovered.response.status,200);assert.notEqual(recovered.value.recoveryCode,user.recoveryCode);
  assert.equal((await f.call('account/me',undefined,'GET',{Cookie:'__Host-wordloom-session='+oldSession})).value.user,null);
  assert.equal((await f.call('account/recover',{username:'learner',code:user.recoveryCode})).response.status,401);
  for(let i=0;i<3;i++)assert.equal((await f.call('account/recover',{username:'learner',code:'bad'})).response.status,401);
  assert.equal((await f.call('account/recover',{username:'learner',code:recovered.value.recoveryCode})).response.status,429);
});
