import test from 'node:test';
import assert from 'node:assert/strict';
import {starterWords} from '../public/starter.js';
import {CloudCollection} from '../public/account.js';

test('offline edits survive reload and conflict resolution is explicit',async t=>{
  const stored=new Map(),storage={getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)},user={id:'first'};
  let remote={data:{words:[],history:[]},revision:0},offline=true;
  const request=async(path,body)=>{if(!body)return structuredClone(remote);if(offline)throw Error('offline');if(body.revision!==remote.revision){const error=Error('conflict');error.status=409;throw error;}remote={data:structuredClone(body.data),revision:remote.revision+1};return {revision:remote.revision};};
  const first=new CloudCollection({request,storage});t.after(()=>first.stop());await first.load(user);first.save({words:[starterWords[0]],history:[]});await first.flush();assert.equal(first.dirty,true);first.stop();
  remote={data:{words:[starterWords[1]],history:[]},revision:1};offline=false;
  const second=new CloudCollection({request,storage});t.after(()=>second.stop());assert.equal((await second.load(user)).words[0].word,starterWords[0].word);assert.ok(second.conflict);await second.flush();assert.equal(remote.data.words[0].word,starterWords[1].word);
  await second.resolve(true);assert.equal(remote.data.words[0].word,starterWords[0].word);assert.equal(second.dirty,false);
  remote={data:{words:[],history:[]},revision:0};assert.equal((await second.load({id:'other'})).words.length,0);
});
test('edits made during an in-flight save are written after it finishes',async t=>{
  const storage={getItem:()=>null,setItem:()=>{}},saved=[];let finish;
  const request=async(path,body)=>{if(!body)return {data:{words:[],history:[]},revision:0};saved.push(structuredClone(body));if(saved.length===1)await new Promise(resolve=>finish=resolve);return {revision:saved.length};};
  const cloud=new CloudCollection({request,storage});t.after(()=>cloud.stop());await cloud.load({id:'one'});cloud.save({words:[starterWords[0]],history:[]});const pending=cloud.flush();cloud.save({words:[starterWords[0],starterWords[1]],history:[]});finish();await pending;assert.equal(saved.length,2);assert.equal(saved[1].data.words.length,2);assert.equal(saved[1].revision,1);assert.equal(cloud.dirty,false);
});
