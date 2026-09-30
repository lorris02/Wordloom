import { schedule, isDue, stage, normalizeWord, validWord, safeWord, shuffled, sentenceIncludes, blankExample, DAY } from './learning.js';
import { starterWords } from './starter.js';
const $ = s => document.querySelector(s);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KEY = 'wordloom-v1';
let storageProblem = false;
let data;
try { const saved=localStorage.getItem(KEY); data=saved ? JSON.parse(saved) : {words:structuredClone(starterWords),history:[]}; if(!Array.isArray(data.words)||!Array.isArray(data.history)) throw Error(); data.words=data.words.filter(validWord).map(safeWord); data.history=data.history.filter(h=>h&&Number.isFinite(h.at)&&typeof h.word==='string').slice(-20000); } catch { storageProblem=true; data={words:structuredClone(starterWords),history:[]}; }
let view = ['today','collection','practice','progress'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today';
let session=null, aiAvailable=false, filter='', sort='recent';
const todayKey = t => new Date(t).toLocaleDateString('en-CA');
const todaysReviews = () => data.history.filter(h=>todayKey(h.at)===todayKey(Date.now())).length;
function save(){try{localStorage.setItem(KEY,JSON.stringify(data));}catch{storageProblem=true;toast('Browser storage is unavailable. Export your words to keep a backup.');}}
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('visible'),4000);}
function source(w){return w.source==='dictionary' ? `<a href="https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w.word)}" target="_blank" rel="noreferrer">Dictionary definition</a>` : w.source==='starter' ? 'Wordloom starter definition' : 'Your own definition';}
function pronounce(w){if(!('speechSynthesis' in window)){toast('Pronunciation isn’t supported in this browser.');return;}speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(w.word);u.lang='en-US';u.rate=.85;speechSynthesis.speak(u);}
function sound(w){return `<button class="sound" data-sound="${escape(w.id)}" aria-label="Hear ${escape(w.word)}">♪</button>`;}
function heading(title,subtitle){return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div></div>`;}
function empty(title,description,action=true){return `<div class="empty"><div class="flower" aria-hidden="true">✳</div><h2>${title}</h2><p>${description}</p>${action?'<button class="button primary" data-add>Add words</button>':''}</div>`;}
function modes(){return `<div class="mode-grid"><button class="mode-card" data-mode="flash"><span class="mode-icon" aria-hidden="true">▱</span><h3>Flip & remember</h3><p>Find the meaning before you flip.</p><span class="mode-end">Flashcards <span>↗</span></span></button><button class="mode-card" data-mode="quiz"><span class="mode-icon" aria-hidden="true">✓</span><h3>Find the right word</h3><p>Connect a meaning to its word.</p><span class="mode-end">Quick quiz <span>↗</span></span></button><button class="mode-card" data-mode="sentence"><span class="mode-icon" aria-hidden="true">✎</span><h3>Make it your own</h3><p>Bring a word to life in a sentence.</p><span class="mode-end">Sentence practice <span>↗</span></span></button></div>`;}
function render(){
  document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  $('#due-count').textContent=data.words.filter(w=>isDue(w)).length;
  $('#date-label').textContent=new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
  let html=session?renderSession():view==='today'?renderToday():view==='collection'?renderCollection():view==='practice'?renderStudio():renderProgress();
  $('#main').innerHTML=(storageProblem?'<div class="notice">Browser storage could not be loaded or saved. Export your words before leaving this page.</div>':'')+html;
  bindView();
}
function renderToday(){
  const word=data.words.find(w=>isDue(w)) || data.words[0];
  const done=todaysReviews(),due=data.words.filter(w=>isDue(w)).length;
  return `<div class="page-heading"><div><h1>Make words yours.</h1><p>A few minutes today. Words that stay with you.</p></div><span class="greeting-note">A good day to grow ✳</span></div>${word?`<div class="today-layout"><section class="feature"><div class="feature-top"><span>A word to spend time with</span><span>${escape(word.part||'Your word')}</span></div><h2>${escape(word.word)}</h2><div class="pronunciation">${escape(word.phonetic)} ${sound(word)}</div><p class="meaning">${escape(word.definition)}</p><button class="button primary" data-mode="flash">Practice this word <span>↗</span></button><div class="word-art" aria-hidden="true">✳</div></section><section class="daily"><h3>Your daily little win</h3><div class="daily-ring" style="--progress:${Math.min(100,done/5*100)}%"><div class="ring-text"><strong>${Math.min(done,5)}<span style="display:inline;font-size:18px"> / 5</span></strong><span>reviews today</span></div></div><p>${done>=5?'Your daily goal is complete. Every extra review is a bonus.':`${due} ${due===1?'word is':'words are'} ready for review. Let’s make a little progress.`}</p><button class="button ${due?'primary':'soft'}" id="daily-review">${due?'Start daily review':'Practice any words'}</button></section></div>`:empty('Your vocabulary starts here.','Add your first word and give it a place to grow.')}<div class="section-heading"><h2>Find your way to remember</h2><button data-view="practice">Explore practice</button></div>${modes()}<div class="section-heading"><h2>Your growing collection</h2><button data-view="collection">See all ${data.words.length} words</button></div><div class="recent-list">${[...data.words].sort((a,b)=>b.added-a.added).slice(0,4).map(w=>`<div class="recent-word"><span class="word-initial">${escape(w.word[0])}</span><div><strong>${escape(w.word)}</strong><small>${escape(w.part||'Personal word')}</small></div><span class="stage ${w.reviews?'':'new'}">${stage(w)}</span></div>`).join('')}</div>`;
}
function renderCollection(){
  let words=data.words.filter(w=>(w.word+' '+w.definition).toLowerCase().includes(filter.toLowerCase()));
  words.sort(sort==='az'?(a,b)=>a.word.localeCompare(b.word):sort==='due'?(a,b)=>a.due-b.due:(a,b)=>b.added-a.added);
  return heading('Your words, taking root.',`${data.words.length} words collected. Each one is a new way to express yourself.`)+`<div class="toolbar"><input class="search" id="search" type="search" placeholder="Find a word or meaning" aria-label="Search words" value="${escape(filter)}"><select id="sort" aria-label="Sort words"><option value="recent" ${sort==='recent'?'selected':''}>Recently added</option><option value="az" ${sort==='az'?'selected':''}>Alphabetical</option><option value="due" ${sort==='due'?'selected':''}>Next review</option></select></div><div class="collection-grid">${words.map(w=>`<article class="word-card"><div class="word-card-top"><h3>${escape(w.word)}</h3>${sound(w)}</div><div class="pronunciation">${escape(w.phonetic)} ${escape(w.part)}</div><p>${escape(w.definition)}</p>${w.example?`<div class="example">${escape(w.example)}</div>`:''}<div class="source-note">${source(w)}</div><div class="word-card-bottom"><span>${isDue(w)?'Ready for review':`Review ${new Date(w.due).toLocaleDateString(undefined,{month:'short',day:'numeric'})}`}</span><button class="delete-word" data-edit="${escape(w.id)}">Edit</button><button class="delete-word" data-delete="${escape(w.id)}">Remove</button></div></article>`).join('')}</div>${!words.length?empty(data.words.length?'No words match that search.':'An empty page. A fresh start.',data.words.length?'Try another word or meaning.':'Add a word you’ve always wanted to use.',!data.words.length):''}`;
}
function renderStudio(){return heading('A little play. A lot of practice.','Recognize it. Recall it. Use it. Find what helps the word stick.')+`<div class="studio-intro"><h3>Remembering is something you do.</h3><p>Try recalling the answer before you reveal it. Practice with different prompts, then come back when your words are ready for another review.</p></div><div class="practice-tools"><label for="practice-scope">Practice</label><select id="practice-scope"><option value="all">All my words</option><option value="due">Words due for review</option></select></div>${modes()}<div class="section-heading"><h2>Put words into context</h2></div><button class="mode-card" data-mode="cloze"><span class="mode-icon">▧</span><h3>Fill the missing word</h3><p>Recall a word from its example sentence.</p><span class="mode-end">Fill in the blank <span>↗</span></span></button><section class="extract-panel"><h3>Found words in something you’re reading?</h3><p>Paste a paragraph and choose the words you want to collect. Selected words go to the dictionary when you add them.</p><label for="reading-text">Your text</label><textarea id="reading-text" rows="4" maxlength="10000" placeholder="Paste a paragraph here…"></textarea><button class="button secondary" id="extract-words">Choose words from text</button><div class="chips" id="extracted"></div><button class="button primary" id="add-extracted" hidden>Add selected words</button></section>`;}
function renderProgress(){
  const reviewed=data.words.filter(w=>w.reviews).length,strong=data.words.filter(w=>w.interval>=14).length;
  const days=Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-6+i);return{label:d.toLocaleDateString('en-US',{weekday:'short'}),count:data.history.filter(h=>todayKey(h.at)===todayKey(d.getTime())).length};});
  const max=Math.max(5,...days.map(d=>d.count));
  const tricky=[...data.words].filter(w=>w.lapses).sort((a,b)=>b.lapses-a.lapses).slice(0,5);
  return heading('Look how far you’ve grown.','Small sessions add up. Here’s what your practice looks like.')+`<div class="stats"><div class="stat"><strong>${data.words.length}</strong><span>words collected</span></div><div class="stat"><strong>${data.history.length}</strong><span>review attempts</span></div><div class="stat"><strong>${strong}</strong><span>growing strong</span></div></div><section class="progress-panel"><h3>Your last seven days</h3><p>Review attempts each day, including words you tried again.</p><div class="week">${days.map(d=>`<div class="day-column"><div class="bar-wrap"><div class="bar" style="height:${Math.max(3,d.count/max*100)}%" title="${d.count} reviews"></div></div><span>${d.label}</span><span>${d.count}</span></div>`).join('')}</div></section><section class="progress-panel"><h3>A collection in bloom</h3><div class="progress-row"><span>New seeds</span><strong>${data.words.length-reviewed}</strong></div><div class="progress-row"><span>Taking root</span><strong>${reviewed-strong}</strong></div><div class="progress-row"><span>Growing strong</span><strong>${strong}</strong></div><p>“Growing strong” means your review interval reached 14 days. It’s a practice milestone, not a guarantee of permanent memory.</p></section><section class="progress-panel"><h3>Give these a little extra care</h3>${tricky.length?tricky.map(w=>`<div class="progress-row"><span>${escape(w.word)}</span><span>${w.lapses} recall ${w.lapses===1?'miss':'misses'}</span></div>`).join(''):'<p>Your tricky words will appear here after a missed recall attempt.</p>'}${tricky.length?'<button class="button soft" id="practice-tricky" style="margin-top:20px">Practice tricky words</button>':''}</section>`;
}
function startSession(mode,scope='all',specific=null){
  let pool=specific||data.words.filter(w=>scope!=='due'||isDue(w));
  if(mode==='cloze')pool=pool.filter(w=>blankExample(w));
  if(!pool.length){toast(mode==='cloze'?'Add an example sentence containing its word to use this mode.':scope==='due'?'You’re caught up! Choose all words to practice more.':'Add a word to start practicing.');return;}
  if(mode==='quiz'&&data.words.length<2){toast('Add at least two words for the quiz.');return;}
  session={mode,words:shuffled(pool).slice(0,10),index:0,revealed:false,answered:false,correct:0,feedback:'',options:null};view='practice';render();$('#main').focus();
}
function renderSession(){
  const s=session;
  if(s.index>=s.words.length)return `<div class="practice-panel"><div class="study-card session-finish"><div class="flower" aria-hidden="true">✳</div><h2>A little wiser.</h2><p class="definition">${s.words.length} words practiced.${s.mode==='quiz'||s.mode==='cloze'?` ${s.correct} correct answers.`:''}</p><p class="example">Your next reviews are scheduled. Come back and see what you remember.</p><button class="button primary" id="finish-session">Back to today</button></div></div>`;
  const w=s.words[s.index],names={flash:'Flip & remember',quiz:'Find the right word',sentence:'Make it your own',cloze:'Fill the missing word'};
  let content='';
  if(s.mode==='flash')content=`<div class="study-card"><p class="prompt">${s.revealed?'Let it sink in.':'Can you recall the meaning?'}</p><h2>${escape(w.word)}</h2><div class="pronunciation">${escape(w.phonetic)} ${sound(w)}</div>${s.revealed?`<p class="definition">${escape(w.definition)}</p>${w.example?`<div class="example">${escape(w.example)}</div>`:''}<div class="source-note">${source(w)}</div>`:''}</div>${s.revealed?`<p class="review-label">How well did you remember?</p><div class="ratings">${[['again','Again','10 min'],['hard','Hard','Sooner'],['good','Got it','Later'],['easy','Easy','Much later']].map(([r,l,t])=>`<button data-rating="${r}">${l}<small>${t}</small></button>`).join('')}</div>`:'<button class="button primary reveal" id="reveal">Reveal meaning</button>'}`;
  if(s.mode==='quiz'){
    if(!s.options)s.options=shuffled([w,...shuffled(data.words.filter(a=>a.id!==w.id)).slice(0,3)]);
    content=`<div class="study-card"><p class="prompt">Which word matches this meaning?</p><p class="definition">${escape(w.definition)}</p></div><div class="options">${s.options.map(o=>`<button class="option ${s.answered&&o.id===w.id?'correct':s.answered&&o.id===s.chosen?'wrong':''}" data-answer="${escape(o.id)}" ${s.answered?'disabled':''}>${escape(o.word)}</button>`).join('')}</div>${s.answered?`<div class="feedback ${s.chosen===w.id?'success':''}">${s.chosen===w.id?'You found it!':`The word is ${escape(w.word)}.`}${w.example?`<p>${escape(w.example)}</p>`:''}<button class="button primary" id="next">Next word</button></div>`:''}`;
  }
  if(s.mode==='cloze')content=`<div class="study-card"><p class="prompt">Which word completes the sentence?</p><p class="definition">${escape(blankExample(w))}</p>${s.revealed?`<p class="example">Hint: ${escape(w.definition)}</p>`:''}</div>${!s.answered?`<form class="answer-form" id="cloze-form"><label for="cloze-answer">The missing word</label><input id="cloze-answer" autocomplete="off" required maxlength="80"><button class="button primary">Check answer</button> <button type="button" class="button secondary" id="hint">Show meaning</button></form>`:`<div class="feedback ${s.chosen===normalizeWord(w.word)?'success':''}">${s.chosen===normalizeWord(w.word)?'Exactly right.':`The missing word is ${escape(w.word)}.`}<button class="button primary" id="next">Next word</button></div>`}`;
  if(s.mode==='sentence')content=`<div class="study-card"><p class="prompt">Give this word a place in your world.</p><h2>${escape(w.word)}</h2><div class="pronunciation">${escape(w.part)} ${sound(w)}</div><p class="definition">${escape(w.definition)}</p></div><form class="answer-form" id="sentence-form"><label for="sentence-input">Write a sentence using “${escape(w.word)}”</label><textarea id="sentence-input" rows="3" required minlength="10" maxlength="1000" placeholder="Think of a moment from your own life…">${escape(s.sentence||'')}</textarea><p class="hint" style="color:var(--muted);font-size:12px;margin-top:9px">${aiAvailable?'AI feedback sends this sentence and the word’s meaning to OpenAI. Avoid personal or sensitive details.':'Self-review mode: compare your sentence with the meaning and example. AI feedback isn’t connected on this host.'}</p><button class="button primary" id="check-sentence">${aiAvailable?'Get AI feedback':'Check & compare'}</button></form>${s.feedback?`<div class="feedback">${escape(s.feedback)}${w.example?`<p>Example: ${escape(w.example)}</p>`:''}<p>Did you use the meaning correctly? Be honest with yourself.</p><div class="ratings"><button data-rating="again">Try again</button><button data-rating="hard">Unsure</button><button data-rating="good">Got it</button><button data-rating="easy">Easy</button></div></div>`:''}`;
  return `<div class="practice-panel"><div class="session-bar"><button id="exit-session">← End session</button><span>${names[s.mode]} · ${s.index+1} of ${s.words.length}</span></div><div class="track"><span style="width:${s.index/s.words.length*100}%"></span></div>${content}</div>`;
}
function review(rating){const w=session.words[session.index];const idx=data.words.findIndex(x=>x.id===w.id);if(idx>=0)data.words[idx]=schedule(data.words[idx],rating);data.history.push({at:Date.now(),word:w.word,rating,mode:session.mode});data.history=data.history.slice(-20000);save();}
function next(){session.index++;session.revealed=false;session.answered=false;session.feedback='';session.sentence='';session.options=null;render();}
function go(nextView){session=null;view=nextView;location.hash=view;render();}
function bindView(){
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>go(b.dataset.view));
  document.querySelectorAll('[data-add]').forEach(b=>b.onclick=openAdd);
  document.querySelectorAll('[data-sound]').forEach(b=>b.onclick=()=>{const w=data.words.find(w=>w.id===b.dataset.sound);if(w)pronounce(w);});
  document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>startSession(b.dataset.mode,$('#practice-scope')?.value||'all',b.closest('.feature')?[data.words.find(w=>isDue(w))||data.words[0]]:null));
  document.querySelectorAll('[data-rating]').forEach(b=>b.onclick=()=>{review(b.dataset.rating);next();});
  if($('#daily-review'))$('#daily-review').onclick=()=>startSession('flash',data.words.some(w=>isDue(w))?'due':'all');
  if($('#practice-tricky'))$('#practice-tricky').onclick=()=>startSession('flash','all',data.words.filter(w=>w.lapses));
  if($('#search'))$('#search').oninput=e=>{const cursor=e.target.selectionStart;filter=e.target.value;render();$('#search').focus();$('#search').setSelectionRange(cursor,cursor);};
  if($('#sort'))$('#sort').onchange=e=>{sort=e.target.value;render();};
  document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{const w=data.words.find(w=>w.id===b.dataset.delete);if(confirm(`Remove “${w.word}” from your collection? Export a backup first if you want to keep it.`)){data.words=data.words.filter(x=>x.id!==w.id);save();render();toast('Word removed.');}});
  document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editWord(b.dataset.edit));
  if($('#reveal'))$('#reveal').onclick=()=>{session.revealed=true;render();};
  if($('#exit-session'))$('#exit-session').onclick=()=>go('practice');
  if($('#finish-session'))$('#finish-session').onclick=()=>go('today');
  if($('#next'))$('#next').onclick=next;
  if($('#hint'))$('#hint').onclick=()=>{session.revealed=true;render();$('#cloze-answer').focus();};
  document.querySelectorAll('[data-answer]').forEach(b=>b.onclick=()=>{if(session.answered)return;session.answered=true;session.chosen=b.dataset.answer;const correct=session.chosen===session.words[session.index].id;if(correct)session.correct++;review(correct?'good':'again');render();});
  if($('#cloze-form'))$('#cloze-form').onsubmit=e=>{e.preventDefault();session.chosen=normalizeWord($('#cloze-answer').value);session.answered=true;const correct=session.chosen===normalizeWord(session.words[session.index].word);if(correct)session.correct++;review(correct?(session.revealed?'hard':'good'):'again');render();};
  if($('#sentence-form'))$('#sentence-form').onsubmit=checkSentence;
  if($('#extract-words'))$('#extract-words').onclick=()=>{
    const tokens=[...new Set(($('#reading-text').value.toLowerCase().match(/[a-z]+(?:[-'][a-z]+)*/g)||[]))].filter(w=>w.length>2&&!data.words.some(a=>a.word===w)).slice(0,100);
    $('#extracted').innerHTML=tokens.map(w=>`<button type="button" class="chip" data-token="${escape(w)}">${escape(w)}</button>`).join('');
    $('#add-extracted').hidden=!tokens.length;
    document.querySelectorAll('[data-token]').forEach(b=>b.onclick=()=>{if(!b.classList.contains('selected')&&document.querySelectorAll('.chip.selected').length>=10){toast('Choose up to 10 words at a time.');return;}b.classList.toggle('selected');});
    if(!tokens.length)toast('No new words found. Try pasting a longer paragraph.');
  };
  if($('#add-extracted'))$('#add-extracted').onclick=()=>{const selected=[...document.querySelectorAll('.chip.selected')].map(b=>b.dataset.token);if(!selected.length){toast('Select the words you want to learn first.');return;}openAdd();$('#new-words').value=selected.join(', ');};
}
async function checkSentence(e){
  e.preventDefault();const current=session,w=current.words[current.index],sentence=$('#sentence-input').value.trim();current.sentence=sentence;
  if(!sentenceIncludes(sentence,w.word)){toast(`Include the exact word “${w.word}” in your sentence.`);return;}
  if(!aiAvailable){current.feedback='Your sentence includes the word. That alone doesn’t prove the meaning is right. Compare it with the definition and example below.';render();return;}
  const button=$('#check-sentence');button.disabled=true;button.textContent='Reading your sentence…';
  try{const r=await fetch('./api/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({word:w.word,definition:w.definition,sentence}),signal:AbortSignal.timeout(25000)});const result=await r.json();if(!r.ok)throw Error(result.error||'Feedback is unavailable.');if(session!==current)return;current.feedback=result.feedback;render();}catch(err){if(session!==current)return;toast(err.message==='The operation was aborted due to timeout'?'Feedback took too long. Try again.':err.message);button.disabled=false;button.textContent='Get AI feedback';}
}
function openAdd(){ $('#add-status').textContent=''; $('#add-dialog').showModal();$('#new-words').focus(); }
$('#add-top').onclick=openAdd;$('#close-add').onclick=()=>$('#add-dialog').close();
$('#add-dialog').addEventListener('click',e=>{if(e.target===$('#add-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
$('#add-form').onsubmit=async e=>{
  e.preventDefault();let words=[...new Set($('#new-words').value.split(/[,;\n]+/).map(normalizeWord).filter(Boolean))];
  const custom=$('#custom-definition').value.trim(),example=$('#custom-example').value.trim();
  if(words.length>10){$('#add-status').textContent='Please add up to 10 words at a time.';return;}
  if(words.some(w=>w.length>80||(!custom&&!/^[a-z][a-z '-]*$/i.test(w)))){$('#add-status').textContent='Use English words up to 80 characters. Add a custom meaning for other entries.';return;}
  if(custom&&words.length!==1){$('#add-status').textContent='A custom meaning needs exactly one word.';return;}
  words=words.filter(w=>!data.words.some(a=>a.word===w));
  if(!words.length){$('#add-status').textContent='These words are already in your collection.';return;}
  $('#save-words').disabled=true;$('#close-add').disabled=true;const added=[],failed=[];
  for(const word of words){
    $('#add-status').textContent=`Looking up ${word}…`;
    try{
      let entry;
      if(custom)entry={word,definition:custom,example,part:'',phonetic:'',source:'personal'};
      else { const r=await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,{signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error();const list=await r.json();const first=list[0];const meaning=first.meanings?.find(m=>m.definitions?.length);const def=meaning?.definitions[0];if(!def?.definition)throw Error();entry={word,definition:def.definition.slice(0,1000),example:(def.example||'').slice(0,1000),part:meaning.partOfSpeech||'',phonetic:first.phonetic||first.phonetics?.find(p=>p.text)?.text||'',source:'dictionary'}; }
      data.words.push({...entry,id:crypto.randomUUID(),due:Date.now(),added:Date.now(),interval:0,reviews:0,lapses:0});added.push(word);
    }catch{failed.push(word);}
  }
  save();render();$('#save-words').disabled=false;$('#close-add').disabled=false;
  if(failed.length){$('#new-words').value=failed.join(', ');$('#add-status').textContent=`${added.length?`Added ${added.length} words. `:''}Couldn’t look up: ${failed.join(', ')}. Check spelling, try again, or enter your own meaning.`;}
  else{$('#add-dialog').close();$('#add-form').reset();toast(`Added ${added.length} ${added.length===1?'word':'words'} to your collection.`);}
};
function editWord(id){
  const w=data.words.find(w=>w.id===id);const d=document.createElement('dialog');d.setAttribute('aria-label',`Edit ${w.word}`);d.innerHTML=`<form class="edit-form"><h2>Edit ${escape(w.word)}</h2><label for="edit-meaning">Meaning</label><textarea id="edit-meaning" required maxlength="1000" rows="3">${escape(w.definition)}</textarea><label for="edit-example">Example sentence</label><textarea id="edit-example" maxlength="1000" rows="3">${escape(w.example)}</textarea><div class="edit-actions"><button class="button primary">Save word</button><button type="button" class="button secondary" id="cancel-edit">Cancel</button></div></form>`;document.body.append(d);d.showModal();d.querySelector('#cancel-edit').onclick=()=>d.close();d.onclose=()=>d.remove();d.querySelector('form').onsubmit=e=>{e.preventDefault();const meaning=d.querySelector('#edit-meaning').value.trim();if(!meaning)return;w.definition=meaning;w.example=d.querySelector('#edit-example').value.trim();w.source='personal';save();d.close();render();toast('Word updated.');};
}
$('#export').onclick=()=>{const blob=new Blob([JSON.stringify({version:1,...data},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`wordloom-${todayKey(Date.now())}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Backup exported.');};
$('#import').onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  try{if(file.size>5000000)throw Error('Choose a backup smaller than 5 MB.');const imported=JSON.parse(await file.text());if(imported.version!==1||!Array.isArray(imported.words)||imported.words.length>5000||!imported.words.every(validWord))throw Error('This isn’t a valid Wordloom backup.');let count=0;for(const raw of imported.words){const w=safeWord(raw);if(!data.words.some(a=>normalizeWord(a.word)===normalizeWord(w.word))){w.id=crypto.randomUUID();data.words.push(w);count++;}}const known=new Set(data.history.map(h=>`${h.at}|${h.word}|${h.rating}|${h.mode}`));if(Array.isArray(imported.history))for(const h of imported.history.slice(-20000)){if(h&&Number.isFinite(h.at)&&typeof h.word==='string'&&['again','hard','good','easy'].includes(h.rating)&&!known.has(`${h.at}|${h.word}|${h.rating}|${h.mode}`)){data.history.push({at:h.at,word:h.word.slice(0,80),rating:h.rating,mode:['flash','quiz','sentence','cloze'].includes(h.mode)?h.mode:'flash'});known.add(`${h.at}|${h.word}|${h.rating}|${h.mode}`);}}data.history=data.history.sort((a,b)=>a.at-b.at).slice(-20000);save();render();toast(`Imported ${count} new words. Existing words were kept.`);}catch(err){toast(err.message);}finally{e.target.value='';}
};
window.addEventListener('hashchange',()=>{const hash=location.hash.slice(1);if(['today','collection','practice','progress'].includes(hash)&&hash!==view){session=null;view=hash;render();}});
window.addEventListener('storage',e=>{if(e.key===KEY)toast('Your collection changed in another tab. Reload this tab to see the latest words.');});
render();
fetch('./api/config',{signal:AbortSignal.timeout(3000)}).then(r=>r.ok?r.json():null).then(config=>{aiAvailable=Boolean(config?.aiAvailable);if(session?.mode==='sentence')render();}).catch(()=>{});
setInterval(()=>{$('#due-count').textContent=data.words.filter(w=>isDue(w)).length;},60000);
