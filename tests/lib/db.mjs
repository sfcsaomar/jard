import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// A real Postgres (PGlite, in memory) with the project's migrations applied, plus the few
// Supabase objects they expect (roles and the storage tables).
const M = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
export async function freshDb() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema storage; create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]); create table storage.objects (id serial primary key, bucket_id text, name text, metadata jsonb);`);
  for (const f of fs.readdirSync(M).sort()) await db.exec(fs.readFileSync(M + f, 'utf8'));
  return db;
}
// Calls a function the way PostgREST does: named arguments from a JSON body.
export async function callRpc(db, fn, args) {
  const names = Object.keys(args || {});
  const sql = `select to_jsonb(public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})) as r`;
  const vals = names.map((n) => { const v = args[n]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : v; });
  const res = await db.query(sql, vals);
  return res.rows[0].r;
}
