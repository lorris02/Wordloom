// The build packs this small app into one Worker without asset-upload credentials.
// Every request uses the Workers Free allowance; no paid bindings are required.
export function createWorker(assets) { return {
  async fetch(request) {
    const url = new URL(request.url);
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    if (url.pathname === '/api/config') {
      if (request.method !== 'GET') return new Response(JSON.stringify({error:'Use GET.'}), {status:405,headers});
      return new Response(JSON.stringify({aiAvailable:false}), {headers});
    }
    if (url.pathname === '/api/feedback') {
      return new Response(JSON.stringify({error:'AI feedback isn’t connected. Use self-review for now.'}), {status:503,headers});
    }
    if (url.pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({error:'API route not found.'}), {status:404,headers});
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', {status:405,headers:{Allow:'GET, HEAD'}});
    }
    const asset = assets[url.pathname === '/' ? '/index.html' : url.pathname];
    if (!asset) return new Response('Not found', {status:404});
    return new Response(request.method === 'HEAD' ? null : asset.content, {headers:{
      'Content-Type':asset.type,
      'Cache-Control':'no-cache',
      'X-Content-Type-Options':'nosniff',
      'X-Frame-Options':'DENY',
      'Referrer-Policy':'strict-origin-when-cross-origin',
      'Content-Security-Policy':"default-src 'self'; connect-src 'self' https://api.dictionaryapi.dev; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'; frame-ancestors 'none'; base-uri 'self'",
    }});
  },
}; }
