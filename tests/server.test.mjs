import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
test('serves the app, exposes capability honestly, and handles missing routes',async()=>{
  const app=createApp();await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.address().port}`;
  try{const home=await fetch(base);assert.equal(home.status,200);assert.match(await home.text(),/Wordloom/);assert.match(home.headers.get('content-security-policy'),/frame-ancestors 'none'/);const config=await(await fetch(base+'/api/config')).json();assert.equal(config.aiAvailable,Boolean(process.env.OPENAI_API_KEY));assert.equal((await fetch(base+'/missing')).status,404);assert.equal((await fetch(base+'/api/feedback')).status,405);if(!process.env.OPENAI_API_KEY)assert.equal((await fetch(base+'/api/feedback',{method:'POST'})).status,503);}finally{await new Promise(resolve=>app.close(resolve));}
});
