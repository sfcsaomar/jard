// Checks on the files themselves (no server, no browser), so mistakes from moving code
// around are caught in seconds:
//  - every file a page loads exists;
//  - the offline cache (sw.js) lists every file the field app loads;
//  - every script compiles;
//  - load order: code that runs while a page loads only uses things defined earlier;
//  - the old colours of the pre-AMAN design do not come back.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { ok, finish } from './lib/check.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PUB = path.join(ROOT, 'public');
const read = (p) => fs.readFileSync(path.join(PUB, p), 'utf8');
const PAGES = ['index.html', 'admin.html', 'company.html', 'account.html'];

const localRefs = (html) => [...html.matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)="(\/[^"]*)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('//'));
const scriptsOf = (html) => [...html.matchAll(/<script src="(\/[^"]+)"><\/script>/g)].map((m) => m[1]);

// ---------- files exist ----------
for (const page of PAGES) {
  const missing = localRefs(read(page)).filter((u) => !fs.existsSync(path.join(PUB, u.split('?')[0])));
  ok(missing.length === 0, `${page}: every linked file exists` + (missing.length ? ' — missing ' + missing.join(', ') : ''));
}

// ---------- offline cache covers the field app ----------
const sw = read('sw.js');
const shell = [...sw.slice(sw.indexOf('const SHELL'), sw.indexOf('];')).matchAll(/'([^']+)'/g)].map((m) => m[1]);
const appFiles = localRefs(read('index.html')).filter((u) => !u.startsWith('/brand/') || shell.includes(u));
const notCached = appFiles.filter((u) => !shell.includes(u) && u !== '/manifest.webmanifest' && u !== '/apple-touch-icon.png');
ok(notCached.length === 0, 'sw.js caches every file the app loads' + (notCached.length ? ' — missing ' + notCached.join(', ') : ''));
const cachedMissing = shell.filter((u) => u !== '/' && !fs.existsSync(path.join(PUB, u)));
ok(cachedMissing.length === 0, 'every file sw.js caches exists' + (cachedMissing.length ? ' — ' + cachedMissing.join(', ') : ''));

// ---------- scripts compile; load order is safe ----------
const strip = (s) => s
  .replace(/\/\/[^\n]*/g, '')
  .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``')
  .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
  .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
const topLevel = (s) => { let d = 0, out = ''; for (const ch of strip(s)) { if (ch === '{') d++; else if (ch === '}') d--; else if (d === 0) out += ch; } return out; };

for (const page of PAGES) {
  const files = scriptsOf(read(page)).filter((u) => u.startsWith('/app/') || u.startsWith('/panel/'));
  const defined = new Map();
  for (const f of files) {
    const src = read(f);
    try { new vm.Script(src, { filename: f }); ok(true, `${f} compiles`); } catch (e) { ok(false, `${f} compiles — ${e.message}`); }
    for (const m of src.matchAll(/^(?:async\s+)?function\s+(\w+)|^(?:const|let|var|class)\s+(\w+)/gm)) {
      const name = m[1] || m[2];
      if (!defined.has(name)) defined.set(name, f);
    }
  }
  const problems = [];
  files.forEach((f, i) => {
    const top = topLevel(read(f));
    for (const [name, where] of defined) {
      if (files.indexOf(where) > i && new RegExp(`(?<![\\w.$])${name.replace('$', '\\$')}\\b`).test(top)) problems.push(`${f} uses ${name} from ${where}`);
    }
  });
  if (files.length) ok(problems.length === 0, `${page}: scripts load in a safe order` + (problems.length ? ' — ' + problems.join('; ') : ''));
}

// ---------- the old design does not come back ----------
const OLD = /#(D9550C|F5F3EF|EDE9E2|DCD6CC|6B6560|242220|B0451F|4B6B4E|F0CDB9|FBEDE5|FFF7F1)\b/i;
const styled = ['index.html', 'admin.html', 'company.html', 'account.html', 'panel.css', 'app/app.css',
  ...fs.readdirSync(path.join(PUB, 'app')).filter((f) => f.endsWith('.js')).map((f) => 'app/' + f),
  ...fs.readdirSync(path.join(PUB, 'panel')).map((f) => 'panel/' + f)];
const oldColour = styled.filter((f) => OLD.test(read(f)));
ok(oldColour.length === 0, 'no pre-AMAN colours in pages, styles or scripts' + (oldColour.length ? ' — ' + oldColour.join(', ') : ''));
ok(!OLD.test(fs.readFileSync(path.join(ROOT, 'netlify/lib/mail.mjs'), 'utf8')), 'no pre-AMAN colours in emails');

// ---------- server functions ----------
for (const f of fs.readdirSync(path.join(ROOT, 'netlify/functions'))) {
  const src = fs.readFileSync(path.join(ROOT, 'netlify/functions', f), 'utf8');
  ok(/export const config = \{[^}]*(path|schedule):/.test(src), `${f} declares its path or schedule`);
}

finish();
