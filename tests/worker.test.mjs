import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/worker.mjs';
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
test('non-API requests delegate to the static assets binding',async()=>{
  let requested;
  const response=await worker.fetch(new Request('https://wordloom.example/missing'),{ASSETS:{fetch(request){requested=request.url;return new Response('Not found',{status:404});}}});
  assert.equal(requested,'https://wordloom.example/missing');
  assert.equal(response.status,404);
});
