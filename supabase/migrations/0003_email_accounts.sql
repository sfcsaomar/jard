-- Email on accounts: invitations, password reset, email confirmation; storage usage and photo cleanup.

alter table public.accounts
  add column email text check (email is null or email = lower(email)),
  add column email_verified_at timestamptz,
  add column needs_password boolean not null default false;
create unique index accounts_email_key on public.accounts (email) where email is not null;

-- One-time links. Only a SHA-256 of the token is stored, so a database leak does not expose live links.
create table public.auth_tokens (
  token_hash text primary key,
  username text not null references public.accounts(username) on delete cascade,
  purpose text not null check (purpose in ('invite', 'reset', 'verify_email')),
  email text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index auth_tokens_user_idx on public.auth_tokens (username, purpose);
alter table public.auth_tokens enable row level security;
revoke all on public.auth_tokens from anon, authenticated;
grant all on public.auth_tokens to service_role;

-- acct_save now also stores the email fields.
create or replace function public.acct_save(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare r accounts;
begin
  insert into accounts (username, role, company_id, project_id, display_name, active, salt, hash,
                        devices, device_info, settings, last_login, created_at, email, email_verified_at, needs_password)
  values (lower(trim(p->>'username')), p->>'role', nullif(p->>'company_id', ''), nullif(p->>'project_id', ''),
          coalesce(p->>'display_name', ''), coalesce((p->>'active')::boolean, true), p->>'salt', p->>'hash',
          coalesce(p->'devices', '[]'::jsonb), coalesce(p->'device_info', '{}'::jsonb),
          case when jsonb_typeof(p->'settings') = 'object' then p->'settings' end,
          (p->>'last_login')::timestamptz, coalesce((p->>'created_at')::timestamptz, now()),
          nullif(lower(trim(p->>'email')), ''), (p->>'email_verified_at')::timestamptz,
          coalesce((p->>'needs_password')::boolean, false))
  on conflict (username) do update set
    role = excluded.role, company_id = excluded.company_id, project_id = excluded.project_id,
    display_name = excluded.display_name, active = excluded.active, salt = excluded.salt, hash = excluded.hash,
    devices = excluded.devices, device_info = excluded.device_info, settings = excluded.settings,
    last_login = excluded.last_login, email = excluded.email, email_verified_at = excluded.email_verified_at,
    needs_password = excluded.needs_password
  returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public.acct_by_email(p_email text) returns jsonb
language sql stable set search_path = public as $$
  select to_jsonb(a) from accounts a where email = lower(trim(p_email));
$$;

-- Issues a token; older unused tokens of the same purpose for the same account stop working.
create or replace function public.tok_create(p_hash text, p_username text, p_purpose text, p_email text, p_minutes integer)
returns void language sql set search_path = public as $$
  update auth_tokens set used_at = now()
    where username = lower(p_username) and purpose = p_purpose and used_at is null;
  insert into auth_tokens (token_hash, username, purpose, email, expires_at)
    values (p_hash, lower(p_username), p_purpose, nullif(lower(p_email), ''), now() + make_interval(mins => p_minutes));
$$;

-- Reads a token without using it (to show the page); null when invalid, used or expired.
create or replace function public.tok_peek(p_hash text) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('username', t.username, 'purpose', t.purpose, 'email', t.email, 'expiresAt', t.expires_at)
  from auth_tokens t where t.token_hash = p_hash and t.used_at is null and t.expires_at > now();
$$;

-- Uses a token once. Returns its details, or null if it was invalid, already used or expired.
create or replace function public.tok_consume(p_hash text, p_purpose text) returns jsonb
language sql set search_path = public as $$
  with u as (
    update auth_tokens set used_at = now()
    where token_hash = p_hash and purpose = p_purpose and used_at is null and expires_at > now()
    returning username, purpose, email)
  select jsonb_build_object('username', username, 'purpose', purpose, 'email', email) from u;
$$;

-- Deleting a company also removes its synced assets (photos are removed by the server through the storage API).
create or replace function public.co_delete(p_id text) returns text
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from accounts where company_id = p_id) then return 'has_users'; end if;
  delete from assets where company_id = p_id;
  delete from companies where id = p_id;
  return 'ok';
end $$;

-- Photo storage in use, in total and per company folder.
create or replace function public.storage_usage() returns jsonb
language sql stable set search_path = public, storage as $$
  select jsonb_build_object(
    'files', count(*),
    'bytes', coalesce(sum((o.metadata->>'size')::bigint), 0),
    'orphanFiles', count(*) filter (where not exists (select 1 from public.companies c where c.id = split_part(o.name, '/', 1)))
  )
  from storage.objects o where o.bucket_id = 'photos';
$$;

-- Photo paths to delete: one company's folder, or (p_company null) every folder whose company no longer exists.
create or replace function public.photo_paths(p_company text, p_limit integer) returns jsonb
language sql stable set search_path = public, storage as $$
  select coalesce(jsonb_agg(name), '[]'::jsonb) from (
    select o.name from storage.objects o
    where o.bucket_id = 'photos'
      and case when p_company is null
               then not exists (select 1 from public.companies c where c.id = split_part(o.name, '/', 1))
               else split_part(o.name, '/', 1) = p_company end
    order by o.name limit least(greatest(p_limit, 1), 1000)) t;
$$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'acct_save', 'acct_by_email', 'tok_create', 'tok_peek', 'tok_consume', 'co_delete', 'storage_usage', 'photo_paths')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
