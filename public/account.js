import {startRegistration,startAuthentication,browserSupportsWebAuthn} from '@simplewebauthn/browser';
import {starterWords} from './starter.js';
import {validWord,safeWord,normalizeWord} from './learning.js';

const $=s=>document.querySelector(s);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cacheKey=id=>'wordloom-account-v1:'+id;
export async function api(path,body,method=body===undefined?'GET':'POST') {
  const response=await fetch('/api/'+path,{method,credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  let result;try{result=await response.json();}catch{throw Error('Account service is unavailable. Please try again.');}
  if(!response.ok){const error=Error(result.error||'Please try again.');error.status=response.status;throw error;}
  return result;
}

// Revision checks prevent a stale tab/device from silently overwriting newer work.
export class CloudCollection {
  constructor({request=api,storage=localStorage,onStatus=()=>{},onConflict=()=>{}}={}) {this.request=request;this.storage=storage;this.onStatus=onStatus;this.onConflict=onConflict;this.user=null;this.generation=0;this.inflight=null;this.timer=null;this.conflict=null;}
  cache() {try{this.storage.setItem(cacheKey(this.user.id),JSON.stringify({data:this.data,revision:this.revision,dirty:this.dirty}));}catch{this.onStatus('Cloud saving active; device backup unavailable.');}}
  async load(user) {
    this.stop();this.user=user;const remote=await this.request('collection');let cached;
    try{cached=JSON.parse(this.storage.getItem(cacheKey(user.id)));}catch{}
    this.revision=remote.revision;this.dirty=false;
    if(cached?.dirty&&Number.isSafeInteger(cached.revision)&&Array.isArray(cached.data?.words)&&cached.data.words.every(validWord)&&Array.isArray(cached.data?.history)&&cached.data.history.every(h=>h&&Number.isFinite(h.at)&&typeof h.word==='string')) {
      this.data=cached.data;this.dirty=true;
      if(cached.revision!==remote.revision){this.conflict=remote;this.onStatus('Choose a version to finish saving.');this.onConflict();}
    }else this.data=remote.data;
    this.cache();if(!this.conflict)this.onStatus(this.dirty?'Changes waiting to save.':'Saved to your account.');
    return structuredClone(this.data);
  }
  save(data) {if(!this.user)return;this.data=structuredClone(data);this.dirty=true;this.generation++;this.cache();if(this.conflict){this.onStatus('Choose a version to finish saving.');return;}this.onStatus('Saving your words…');clearTimeout(this.timer);this.timer=setTimeout(()=>{void this.flush();},800);}
  async flush() {
    clearTimeout(this.timer);
    if(this.inflight){await this.inflight;if(this.dirty&&!this.conflict)return this.flush();return;}
    if(!this.user||!this.dirty||this.conflict)return;
    const user=this.user,generation=this.generation;
    this.inflight=(async()=>{
      try {
        const result=await this.request('collection',{data:this.data,revision:this.revision},'PUT');
        if(this.user!==user)return;this.revision=result.revision;
        if(generation===this.generation)this.dirty=false;
        this.cache();this.onStatus(this.dirty?'Saving your latest changes…':'Saved to your account.');
      }catch(error){
        if(this.user!==user)return;
        if(error.status===409){try{this.conflict=await this.request('collection');this.onConflict();}catch{this.conflict={unavailable:true};}this.onStatus('Collection changed elsewhere. Choose a version in Account.');}
        else if(error.status===401)this.onStatus('Session expired. Sign in again to save these changes.');
        else {this.onStatus(error.status===400||error.status===413?'Cloud limit reached. Export a backup or reduce your collection.':'Not saved to the cloud yet. Kept on this device; retrying.');if(![400,413].includes(error.status))this.timer=setTimeout(()=>{void this.flush();},30000);}
      }finally{this.inflight=null;}
    })();
    await this.inflight;
    // A newer edit made while the request was running must get its own write.
    if(this.user===user&&this.dirty&&!this.conflict&&generation!==this.generation)return this.flush();
  }
  async resolve(useLocal) {
    if(!this.conflict)return this.data;
    const remote=await this.request('collection');
    this.revision=remote.revision;this.conflict=null;
    if(useLocal){this.cache();await this.flush();}else{this.data=remote.data;this.dirty=false;this.cache();this.onStatus('Saved to your account.');}
    return structuredClone(this.data);
  }
  stop(){clearTimeout(this.timer);this.user=null;this.conflict=null;this.dirty=false;this.generation++;}
}

export function setupAccounts({getData,loadData,loadGuest,toast}) {
  let user=null,mode='login',recoveryCode=null,busy=false;
  const dialog=$('#account-dialog');
  const cloud=new CloudCollection({onStatus:message=>{$('#sync-status').textContent=message;$('#storage-note').textContent=message;},onConflict:()=>toast('Your words changed elsewhere. Open Account to choose which version to keep.')});
  function refresh(){$('#account-open').textContent=user?user.name:'Sign in';$('#account-open').setAttribute('aria-label',user?'Open account':'Sign in');$('#sync-status').hidden=!user;$('#storage-note').textContent=user?$('#sync-status').textContent:'Saved in this browser. No account needed.';}
  function open(next='login'){mode=next;draw();if(!dialog.open)dialog.showModal();}
  function draw(){
    let content;
    if(recoveryCode)content=`<div class="account-flower" aria-hidden="true">✳</div><h2>Keep your way back.</h2><p>Save this recovery code in your password manager. It can sign you into your account if you lose your passkey. We only show it now.</p><label for="recovery-code">Recovery code for ${escape(user.username)}</label><input id="recovery-code" value="${escape(recoveryCode)}" readonly autocomplete="off"><p class="hint">Keep it private. Using it replaces the code and signs out other sessions.</p><button class="button secondary" id="download-code">Download recovery code</button> <button class="button primary" id="saved-code">I saved my code</button>`;
    else if(user)content=`<div class="account-flower" aria-hidden="true">✳</div><h2>A home for your words.</h2><p>Signed in as <strong>${escape(user.name)}</strong> · @${escape(user.username)}</p><div class="account-sync">${escape($('#sync-status').textContent)}</div>${cloud.conflict?'<div class="notice"><p>Another device saved a different version. Export a backup before replacing either version.</p><button class="button secondary" id="use-cloud">Use cloud version</button> <button class="button secondary" id="use-local">Keep this device’s version</button></div>':''}<div class="account-actions"><button class="button secondary" id="sync-now">Save now</button><button class="button secondary" id="add-passkey">Add a passkey</button><button class="button secondary" id="new-code">Replace recovery code</button><button class="button secondary" id="logout">Sign out</button></div><p class="hint">A synced passkey works wherever your password manager supports it. You can also add a passkey on another device after signing in with your recovery code.</p>`;
    else content=`<div class="account-flower" aria-hidden="true">✳</div><h2>${mode==='create'?'Let your words travel.':mode==='recover'?'Find your way back.':'Welcome back.'}</h2><p>${mode==='create'?'Save your vocabulary and practice across devices. Create a passkey with your device’s fingerprint, face, PIN, or a security key.':mode==='recover'?'Enter your username and saved recovery code. You’ll get a replacement code after signing in.':'Sign in with a passkey to pick up where you left off.'}</p><div class="account-tabs"><button type="button" data-account-mode="login" aria-pressed="${mode==='login'}">Sign in</button><button type="button" data-account-mode="create" aria-pressed="${mode==='create'}">Create account</button><button type="button" data-account-mode="recover" aria-pressed="${mode==='recover'}">Recover account</button></div><form id="account-form">${mode==='create'?'<label for="account-name">Your name</label><input id="account-name" autocomplete="nickname" maxlength="50" required>':''}${mode!=='login'?'<label for="account-username">Username</label><input id="account-username" autocomplete="username webauthn" minlength="3" maxlength="24" pattern="[a-zA-Z0-9_]{3,24}" required><p class="hint">3–24 letters, numbers, or underscores.</p>':''}${mode==='recover'?'<label for="account-code">Recovery code</label><input id="account-code" autocomplete="off" spellcheck="false" required>':''}<button class="button primary" type="submit">${mode==='create'?'Create account with a passkey':mode==='recover'?'Recover my account':'Sign in with a passkey'}</button></form><p class="hint">No email or password needed. Your biometric data stays with your device. Signed-in words and progress are saved to Wordloom’s cloud database.</p><button class="text-button" id="continue-guest">Keep practicing as a guest</button>`;
    dialog.innerHTML=`<div class="dialog-heading"><span class="account-wordmark">wordloom</span><button class="icon-button" id="close-account" aria-label="Close account">×</button></div>${content}<p id="account-error" role="alert"></p>`;
    if(user&&!recoveryCode){const actions=dialog.querySelector('.account-actions');const guestButton=document.createElement('button');guestButton.className='button secondary';guestButton.textContent='Import guest words';guestButton.onclick=()=>run(async()=>{
      let guest;try{guest=JSON.parse(localStorage.getItem('wordloom-v1'));}catch{}
      if(!Array.isArray(guest?.words))throw Error('There are no saved guest words on this device.');
      const current=structuredClone(getData()),known=new Set(current.words.map(w=>normalizeWord(w.word)));let count=0;
      for(const raw of guest.words.filter(validWord)){const w=safeWord(raw);if(!known.has(normalizeWord(w.word))){w.id=crypto.randomUUID();current.words.push(w);known.add(normalizeWord(w.word));count++;}}
      if(current.words.length>5000)throw Error('Keep your account collection under 5,000 words. Export a guest backup instead.');
      const reviews=new Set(current.history.map(h=>JSON.stringify([h.at,h.word,h.rating,h.mode])));
      for(const h of (Array.isArray(guest.history)?guest.history:[])){if(h&&Number.isFinite(h.at)&&typeof h.word==='string'&&h.word.length<=80&&['again','hard','good','easy'].includes(h.rating)&&['flash','quiz','sentence','cloze'].includes(h.mode)){const key=JSON.stringify([h.at,h.word,h.rating,h.mode]);if(!reviews.has(key)){current.history.push({at:h.at,word:h.word,rating:h.rating,mode:h.mode});reviews.add(key);}}}
      current.history=current.history.sort((a,b)=>a.at-b.at).slice(-20000);cloud.save(current);loadData(current);await cloud.flush();draw();toast(`Imported ${count} guest words. Your existing account words were kept.`);
    });actions.append(guestButton);
      const again=document.createElement('button');again.className='button secondary';again.textContent='Sign in again';again.onclick=()=>run(async()=>{checkSupport();await cloud.flush();const {options}=await api('account/login/options',{});const credential=await startAuthentication({optionsJSON:options});await enter(await api('account/login/verify',{credential}));draw();});actions.append(again);
    }
    $('#close-account').onclick=()=>dialog.close();
    dialog.querySelectorAll('[data-account-mode]').forEach(button=>button.onclick=()=>{mode=button.dataset.accountMode;draw();});
    if($('#continue-guest'))$('#continue-guest').onclick=()=>dialog.close();
    if($('#account-form'))$('#account-form').onsubmit=authenticate;
    if($('#saved-code'))$('#saved-code').onclick=()=>{recoveryCode=null;draw();};
    if($('#download-code'))$('#download-code').onclick=()=>{const url=URL.createObjectURL(new Blob([`Wordloom recovery code\nUsername: ${user.username}\nCode: ${recoveryCode}\nKeep this private.\n`],{type:'text/plain'})),a=document.createElement('a');a.href=url;a.download='wordloom-recovery-code.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    if($('#sync-now'))$('#sync-now').onclick=()=>run(async()=>{await cloud.flush();draw();});
    if($('#use-cloud'))$('#use-cloud').onclick=()=>run(async()=>{loadData(await cloud.resolve(false));draw();});
    if($('#use-local'))$('#use-local').onclick=()=>run(async()=>{loadData(await cloud.resolve(true));draw();});
    if($('#add-passkey'))$('#add-passkey').onclick=()=>run(async()=>{checkSupport();const {options}=await api('account/passkey/options',{});const credential=await startRegistration({optionsJSON:options});await api('account/passkey/verify',{credential});toast('Passkey added.');draw();});
    if($('#new-code'))$('#new-code').onclick=()=>run(async()=>{recoveryCode=(await api('account/recovery',{})).recoveryCode;draw();});
    if($('#logout'))$('#logout').onclick=()=>run(async()=>{await cloud.flush();const pending=cloud.dirty;await api('account/logout',{});if(!pending){try{localStorage.removeItem(cacheKey(user.id));}catch{}}cloud.stop();user=null;recoveryCode=null;loadGuest();refresh();dialog.close();toast(pending?'Signed out. Pending changes remain on this device until you sign into this account again.':'Signed out. You’re back in guest mode.');});
    if(busy)dialog.querySelectorAll('button,input').forEach(el=>el.disabled=true);
  }
  function checkSupport(){if(!browserSupportsWebAuthn())throw Error('Passkeys aren’t supported in this browser. Use a recent Chrome, Edge, Safari, or Firefox, or sign in with a recovery code.');}
  async function run(action){if(busy)return;busy=true;$('#account-error').textContent='';dialog.querySelectorAll('button,input').forEach(el=>el.disabled=true);try{await action();}catch(error){$('#account-error').textContent=['NotAllowedError','AbortError'].includes(error.name)?'Passkey request was cancelled or timed out. Try again when you’re ready.':error.message;}finally{busy=false;dialog.querySelectorAll('button,input').forEach(el=>el.disabled=false);}}
  async function enter(result){
    // The account is authenticated before any cached account collection is loaded.
    let snapshot=await cloud.load(result.user);
    user=result.user;recoveryCode=result.recoveryCode||null;
    if(cloud.revision===0&&!cloud.dirty&&!snapshot.words.length){snapshot={words:structuredClone(starterWords),history:[]};cloud.save(snapshot);}
    loadData(snapshot);refresh();
    if(cloud.dirty&&!cloud.conflict)void cloud.flush();
  }
  async function authenticate(event){event.preventDefault();const name=$('#account-name')?.value,username=$('#account-username')?.value,code=$('#account-code')?.value;await run(async()=>{
    let result;
    if(mode==='recover')result=await api('account/recover',{username,code});
    else {checkSupport();const create=mode==='create',route=create?'register':'login';const {options}=await api(`account/${route}/options`,create?{name,username}:{});const credential=await (create?startRegistration:startAuthentication)({optionsJSON:options});result=await api(`account/${route}/verify`,{credential});}
    await enter(result);draw();if(!recoveryCode&&!cloud.conflict)dialog.close();toast('You’re signed in. Your account collection is ready.');
  });}
  $('#account-open').onclick=()=>open();
  window.addEventListener('online',()=>{void cloud.flush();});
  window.addEventListener('beforeunload',event=>{if(user&&cloud.dirty){event.preventDefault();event.returnValue='';}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')void cloud.flush();});
  return {get user(){return user;},save:data=>cloud.save(data),async initialize(){try{const result=await api('account/me');if(result.user)await enter(result);}catch{}refresh();}};
}
