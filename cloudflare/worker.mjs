// Static assets are served by Cloudflare before this handler runs.
// Only API and unmatched routes invoke the Worker.
export default {
  async fetch(request, env) {
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
    return env.ASSETS.fetch(request);
  },
};
