export const DAY = 86400000;
export function schedule(word, rating, now = Date.now()) {
  if (!['again', 'hard', 'good', 'easy'].includes(rating)) throw new Error('Unknown review rating');
  const old = Number(word.interval) || 0;
  const interval = rating === 'again' ? 0 : rating === 'hard' ? Math.max(1, old * 1.2) : rating === 'good' ? Math.max(1, old ? old * 2 : 1) : Math.max(3, old ? old * 2.8 : 3);
  return { ...word, interval, due: now + (rating === 'again' ? 10 * 60000 : interval * DAY), reviews: (word.reviews || 0) + 1, lapses: (word.lapses || 0) + (rating === 'again' ? 1 : 0), lastReviewed: now };
}
export function isDue(word, now = Date.now()) { return Number(word.due) <= now; }
export function stage(word) { return word.interval >= 14 ? 'Growing strong' : word.reviews ? 'Taking root' : 'New seed'; }
export function normalizeWord(value) { return value.trim().toLowerCase().replace(/\s+/g, ' '); }
export function validWord(w) { return Boolean(w && typeof w.id === 'string' && typeof w.word === 'string' && w.word.length > 0 && w.word.length <= 80 && typeof w.definition === 'string' && w.definition.length > 0 && w.definition.length <= 1000 && Number.isFinite(w.due)); }
export function safeWord(w) {
  return { id: w.id.slice(0, 100), word: w.word.slice(0, 80), definition: w.definition.slice(0, 1000), example: typeof w.example === 'string' ? w.example.slice(0, 1000) : '', phonetic: typeof w.phonetic === 'string' ? w.phonetic.slice(0, 100) : '', part: typeof w.part === 'string' ? w.part.slice(0, 50) : '', source: w.source === 'dictionary' ? 'dictionary' : w.source === 'starter' ? 'starter' : 'personal', interval: Math.max(0, Math.min(3650, Number(w.interval) || 0)), reviews: Math.max(0, Number(w.reviews) || 0), lapses: Math.max(0, Number(w.lapses) || 0), due: w.due, added: Number(w.added) || Date.now(), lastReviewed: Number(w.lastReviewed) || 0 };
}
export function shuffled(items) { const a = [...items]; for(let i=a.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
export function sentenceIncludes(sentence, word) { const escaped=word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'i').test(sentence); }
export function blankExample(word) { if (!word.example || !sentenceIncludes(word.example, word.word)) return null; const escaped=word.word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); return word.example.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '________'); }
