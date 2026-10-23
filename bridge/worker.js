/**
 * Annotino sign-in bridge (Cloudflare Worker).
 *
 * GitHub only hands out a user's access token in exchange for the app's client
 * secret, and its token endpoint cannot be called from a browser. This worker
 * does that one exchange and nothing else: it never sees recordings or
 * annotations (those go straight from the browser to GitHub, encrypted), it
 * stores nothing and logs nothing.
 *
 *   POST /token    { code, code_verifier, redirect_uri }  → tokens
 *   POST /refresh  { refresh_token }                       → tokens
 *
 * Settings (wrangler secrets/vars): GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET,
 * ALLOWED_ORIGINS (comma-separated, e.g. https://you.github.io).
 */

const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

function reply(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const isString = (v) => typeof v === 'string' && v.length > 0 && v.length < 2048;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '';
    const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!allowed.includes(origin)) return new Response('Origin not allowed', { status: 403 });
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const { pathname } = new URL(request.url);
    if (request.method !== 'POST' || (pathname !== '/token' && pathname !== '/refresh')) {
      return reply({ error: 'not_found' }, 404, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return reply({ error: 'bad_request' }, 400, cors);
    }

    const params = { client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET };
    if (pathname === '/token') {
      if (!isString(body.code)) return reply({ error: 'bad_request' }, 400, cors);
      params.code = body.code;
      if (isString(body.code_verifier)) params.code_verifier = body.code_verifier;
      if (isString(body.redirect_uri)) params.redirect_uri = body.redirect_uri;
    } else {
      if (!isString(body.refresh_token)) return reply({ error: 'bad_request' }, 400, cors);
      params.grant_type = 'refresh_token';
      params.refresh_token = body.refresh_token;
    }

    const res = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'annotino-bridge' },
      body: JSON.stringify(params),
    });
    const data = await res.json().catch(() => ({ error: 'github_unavailable' }));
    if (!res.ok || data.error || !data.access_token) {
      return reply({ error: data.error ?? 'github_error', error_description: data.error_description }, 400, cors);
    }
    // Pass on only what the page needs.
    return reply(
      {
        access_token: data.access_token,
        expires_in: data.expires_in,
        refresh_token: data.refresh_token,
        refresh_token_expires_in: data.refresh_token_expires_in,
      },
      200,
      cors,
    );
  },
};
