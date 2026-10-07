// A local copy of the site for tests: the real Netlify functions and the real pages, with
// Supabase (database + photo storage) and Resend replaced by in-process stand-ins.
// Nothing here talks to the live Supabase or Resend.
//
//   const s = await startServer({ port: 8901, legacy: true });
//   ... fetch(s.url + '/api/health') ...
//   await s.close();
//
// Test-only endpoints: /__mail (sent emails), /__maildown?v=1 (make Resend fail),
// /__sql (run SQL against the test database).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshDb, callRpc } from './db.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json'
};

export async function startServer({ port, legacy = false } = {}) {
  const base = `http://localhost:${port}`;
  Object.assign(process.env, {
    TOKEN_SECRET: 'x'.repeat(32),
    ADMIN_PASSWORD: 'emergency-pass-123',
    SUPABASE_URL: base + '/supa',
    SUPABASE_SERVICE_KEY: 'test-service-key-0123456789',
    RESEND_API_KEY: 're_test_key_123456',
    RESEND_URL: base + '/__resend',
    APP_URL: base,
    ANTHROPIC_ADMIN_URL: base + '/__anthropic',
    ANTHROPIC_ADMIN_KEY: 'test-admin-key-not-real-0123456789'
  });
  const pg = await freshDb();
  const common = await import(ROOT + 'netlify/lib/common.mjs');
  const dbm = await import(ROOT + 'netlify/lib/db.mjs');

  // Content of the old Netlify Blobs store, as v2.0 wrote it (imported once on first request).
  const store = new Map();
  if (legacy) {
    const put = (k, v) => store.set(k, JSON.stringify(v));
    put('licenses/old1', { id: 'old1', customer: 'شركة قديمة', startsAt: '2026-09-01', months: 12, expiresAt: '2027-08-31', maxUsers: 1, maxDevicesPerUser: 1, active: true, aiEnabled: true, aiMonthlyCap: 100, createdAt: '2026-09-01T10:00:00Z' });
    put('projects/old1/pold', { id: 'pold', companyId: 'old1', name: 'مشروع قديم', active: true, settings: { lang: 'en', required: ['brand'], minPhotos: 2 }, categories: [{ code: '1', name: 'Furniture', subs: [{ code: '11', name: 'Chairs' }] }], createdAt: '2026-09-02T10:00:00Z' });
    put('users/old.user', { username: 'old.user', licenseId: 'old1', projectId: 'pold', active: true, devices: ['devOld'], deviceInfo: { devOld: { addedAt: '2026-09-03T00:00:00Z' } }, ...common.hashPassword('oldpass123'), createdAt: '2026-09-02T11:00:00Z' });
    put('users/old.extra', { username: 'old.extra', licenseId: 'old1', projectId: 'pold', active: true, devices: [], ...common.hashPassword('oldpass123') }); // over the limit of 1: must still import
    put('users/old.admin', { username: 'old.admin', licenseId: 'old1', role: 'admin', active: true, devices: [], ...common.hashPassword('oldadmin123') });
    put('usage/old1/2026-10', { count: 42, inputTokens: 1000, outputTokens: 50 });
  }
  dbm._setLegacyStoreForTests({
    async list({ prefix }) { return { blobs: [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; },
    async get(k) { return store.has(k) ? JSON.parse(store.get(k)) : null; }
  });

  const fns = {};
  for (const f of fs.readdirSync(ROOT + 'netlify/functions')) {
    if (f.endsWith('.mjs')) fns[f.replace('.mjs', '')] = (await import(ROOT + 'netlify/functions/' + f)).default;
  }

  const objects = new Map();
  const mails = [];
  let mailDown = false;

  async function supa(req, res, url, body) {
    if (req.headers.apikey !== process.env.SUPABASE_SERVICE_KEY && !url.searchParams.get('token')) { res.writeHead(401); return res.end('{}'); }
    const p = url.pathname.slice('/supa'.length);
    res.setHeader('access-control-allow-origin', '*');
    const json = (status, v) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
    let m;
    if ((m = p.match(/^\/rest\/v1\/rpc\/(\w+)$/))) {
      try { return json(200, (await callRpc(pg, m[1], JSON.parse(body || '{}'))) ?? null); }
      catch (e) { return json(400, { code: e.code, message: e.message }); }
    }
    if ((m = p.match(/^\/storage\/v1\/object\/upload\/sign\/photos\/(.+)$/))) {
      if (req.method === 'POST') return json(200, { url: `/object/upload/sign/photos/${m[1]}?token=up` });
      if (req.method === 'PUT') {
        objects.set(m[1], body);
        await pg.query("insert into storage.objects (bucket_id, name, metadata) values ('photos', $1, $2)", [m[1], JSON.stringify({ size: body.length })]);
        return json(200, { Key: 'x' });
      }
    }
    if (p === '/storage/v1/object/photos' && req.method === 'DELETE') {
      for (const k of JSON.parse(body).prefixes) {
        objects.delete(k);
        await pg.query("delete from storage.objects where bucket_id='photos' and name=$1", [k]);
      }
      return json(200, []);
    }
    if (p === '/storage/v1/object/sign/photos' && req.method === 'POST') {
      const { paths } = JSON.parse(body);
      return json(200, paths.map((pt) => ({ path: pt, signedURL: objects.has(pt) ? `/object/sign/photos/${pt}?token=dl` : null })));
    }
    if ((m = p.match(/^\/storage\/v1\/object\/sign\/photos\/(.+)$/))) {
      const o = objects.get(m[1]);
      if (!o) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(o);
    }
    res.writeHead(404); res.end('not mocked: ' + p);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, base);
      const chunks = []; for await (const c of req) chunks.push(c);
      const buf = Buffer.concat(chunks);
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': '*', 'access-control-allow-headers': '*' }); return res.end(); }
      if (url.pathname === '/__resend') {
        if (req.headers.authorization !== 'Bearer ' + process.env.RESEND_API_KEY) { res.writeHead(401); return res.end('{}'); }
        if (mailDown) { res.writeHead(500); return res.end('down'); }
        mails.push(JSON.parse(buf.toString()));
        res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"id":"m1"}');
      }
      if (url.pathname === '/__mail') return res.end(JSON.stringify(mails));
      // Anthropic cost report: $1.50 a day for the last 5 days (amounts are cents as decimal strings).
      if (url.pathname === '/__anthropic/v1/organizations/cost_report') {
        if (req.headers['x-api-key'] !== 'test-admin-key-not-real-0123456789') { res.writeHead(401); return res.end('{}'); }
        const from = Date.parse(url.searchParams.get('starting_at'));
        const data = [];
        for (let i = 4; i >= 0; i--) {
          const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
          if (Date.parse(day) >= from) data.push({ starting_at: day + 'T00:00:00Z', ending_at: day + 'T23:59:59Z', results: [{ currency: 'USD', amount: '100.00' }, { currency: 'USD', amount: '50.00' }] });
        }
        res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data, has_more: false, next_page: null }));
      }
      if (url.pathname === '/__maildown') { mailDown = url.searchParams.get('v') === '1'; return res.end('ok'); }
      if (url.pathname === '/__sql') { const r = await pg.query(buf.toString()); return res.end(JSON.stringify(r.rows)); }
      if (url.pathname.startsWith('/supa/')) return supa(req, res, url, req.method === 'PUT' ? buf : buf.toString());
      if (url.pathname.startsWith('/api/')) {
        const fn = fns[url.pathname.slice(5)];
        if (!fn) { res.writeHead(404); return res.end('{}'); }
        const r = await fn(new Request(base + req.url, { method: req.method, headers: req.headers, body: req.method === 'POST' ? buf : undefined }), { ip: req.headers['x-test-ip'] || '127.0.0.1' });
        res.writeHead(r.status, { 'content-type': 'application/json' }); return res.end(await r.text());
      }
      let fp = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
      if (!path.extname(fp)) fp += '.html';
      const file = path.join(ROOT, 'public', path.normalize(fp));
      if (!file.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      console.error('test server error', e);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(port, resolve));

  return {
    url: base,
    pg,
    mails: () => mails,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); })
  };
}
