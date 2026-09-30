import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../cloudflare/worker.mjs';
const worker=createWorker({'/index.html':{content:'<h1>Wordloom</h1>',type:'text/html; charset=utf-8'},'/app.js':{content:'// app',type:'text/javascript; charset=utf-8'}});
test('Cloudflare reports AI status and returns clear errors without provider calls',async()=>{
  const config=await worker.fetch(new Request('https://wordloom.example/api/config'),{});
  assert.equal(config.status,200);
  assert.deepEqual(await config.json(),{aiAvailable:false});
  assert.equal(config.headers.get('Cache-Control'),'no-store');
  const feedback=await worker.fetch(new Request('https://wordloom.example/api/feedback',{method:'POST'}),{});
  assert.equal(feedback.status,503);
  assert.match((await feedback.json()).error,/self-review/);
  assert.equal((await worker.fetch(new Request('https://wordloom.example/api/unknown'),{})).status,404);
});
test('serves packed assets with security headers and handles HEAD and missing paths',async()=>{
  const home=await worker.fetch(new Request('https://wordloom.example/'));
  assert.equal(await home.text(),'<h1>Wordloom</h1>');
  assert.match(home.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
  const script=await worker.fetch(new Request('https://wordloom.example/app.js'));
  assert.match(script.headers.get('Content-Type'),/javascript/);
  const head=await worker.fetch(new Request('https://wordloom.example/',{method:'HEAD'}));
  assert.equal(await head.text(),'');
  assert.equal((await worker.fetch(new Request('https://wordloom.example/missing'))).status,404);
  assert.equal((await worker.fetch(new Request('https://wordloom.example/',{method:'POST'}))).status,405);
});
