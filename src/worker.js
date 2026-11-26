// Cloudflare Worker: serve o app (arquivos em /public) e a API de sincronização (D1).
//
// Rotas:
//   GET  /api/health  -> {ok, configured}  (com "Authorization: Bearer <senha>" também valida a senha)
//   POST /api/sync    -> envia alterações locais e recebe as do servidor (precisa da senha)
//
// A senha fica num "secret" da Cloudflare chamado APP_PASSWORD:
//   npx wrangler secret put APP_PASSWORD

const TABLES = ['songs', 'medleys'];
const MAX_BODY = 8 * 1024 * 1024;
const MAX_RECORD = 400 * 1024;

let schemaReady = false;

async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS songs (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL, server_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS songs_server_at ON songs (server_at)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS medleys (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL, server_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS medleys_server_at ON medleys (server_at)'),
  ]);
  schemaReady = true;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

async function sha256(text) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
}

async function checkAuth(header, env) {
  const m = /^Bearer\s+(.+)$/i.exec(header || '');
  if (!m || !env.APP_PASSWORD) return false;
  const [a, b] = await Promise.all([sha256(m[1].trim()), sha256(String(env.APP_PASSWORD))]);
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(a, b);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{4,80}$/.test(id);

async function handleSync(request, env) {
  if (!env.APP_PASSWORD) return json({ error: 'O servidor ainda não tem senha (APP_PASSWORD).' }, 503);
  if (!(await checkAuth(request.headers.get('Authorization'), env))) {
    await new Promise((r) => setTimeout(r, 400)); // freia tentativas de adivinhar a senha
    return json({ error: 'Senha incorreta' }, 401);
  }
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_BODY) return json({ error: 'Envio grande demais' }, 413);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  await ensureSchema(env);

  const now = Date.now();
  const since = Math.max(0, Number(body.since) || 0);
  const stmts = [];
  let rejected = 0;
  for (const table of TABLES) {
    const list = Array.isArray(body[table]) ? body[table].slice(0, 5000) : [];
    for (const rec of list) {
      if (!rec || !validId(rec.id)) { rejected++; continue; }
      const data = JSON.stringify(rec);
      if (data.length > MAX_RECORD) { rejected++; continue; }
      const updatedAt = Math.min(Number(rec.updatedAt) || now, now + 60_000);
      stmts.push(env.DB.prepare(
        `INSERT INTO ${table} (id, data, updated_at, server_at, deleted) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, server_at = excluded.server_at, deleted = excluded.deleted
         WHERE excluded.updated_at >= ${table}.updated_at`,
      ).bind(rec.id, data, updatedAt, now, rec.deleted ? 1 : 0));
    }
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));

  const out = { now, rejected };
  for (const table of TABLES) {
    const { results } = await env.DB.prepare(`SELECT data FROM ${table} WHERE server_at > ?1 ORDER BY server_at`).bind(since).all();
    out[table] = results.map((r) => JSON.parse(r.data));
  }
  return json(out);
}

async function handleHealth(request, env) {
  const configured = Boolean(env.APP_PASSWORD);
  const auth = request.headers.get('Authorization');
  if (!configured) return json({ ok: false, configured, error: 'O servidor ainda não tem senha (APP_PASSWORD).' }, 503);
  if (auth) {
    const ok = await checkAuth(auth, env);
    if (!ok) { await new Promise((r) => setTimeout(r, 400)); return json({ ok: false, configured, error: 'Senha incorreta' }, 401); }
    return json({ ok: true, configured, authed: true, time: Date.now() });
  }
  return json({ ok: true, configured, time: Date.now() });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        if (url.pathname === '/api/health' && request.method === 'GET') return await handleHealth(request, env);
        if (url.pathname === '/api/sync' && request.method === 'POST') return await handleSync(request, env);
        return json({ error: 'Não encontrado' }, 404);
      } catch (e) {
        console.error('api error', e && e.stack || e);
        return json({ error: 'Erro no servidor' }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
