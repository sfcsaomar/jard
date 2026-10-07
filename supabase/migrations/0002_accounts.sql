-- Accounts, licenses and projects (moved from Netlify Blobs).
-- Only the server (service role) reads or writes; every function below is closed to anon/authenticated.
-- Passwords are stored as scrypt hashes with a per-account salt, never as text.

create table public.companies (
  id text primary key,
  customer text not null,
  starts_at date,
  months integer not null default 12,
  expires_at date,
  max_users integer not null default 1 check (max_users >= 1),
  max_devices_per_user integer not null default 1 check (max_devices_per_user >= 1),
  ai_enabled boolean not null default true,
  ai_monthly_cap integer not null default 0,
  active boolean not null default true,
  contact_name text not null default '',
  contact_phone text not null default '',
  contact_email text not null default '',
  notes text not null default '',
  renewals jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.projects (
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  notes text not null default '',
  settings jsonb not null default '{}'::jsonb,
  categories jsonb not null default '[]'::jsonb,
  categories_updated_at timestamptz,
  created_at timestamptz not null default now()
);
create index projects_company_idx on public.projects (company_id);

-- role: 'user' = field user, 'admin' = company admin, 'super' = provider admin (no company).
create table public.accounts (
  username text primary key check (username = lower(username)),
  role text not null check (role in ('user', 'admin', 'super')),
  company_id text references public.companies(id) on delete restrict,
  project_id text references public.projects(id) on delete restrict,
  display_name text not null default '',
  active boolean not null default true,
  salt text not null,
  hash text not null,
  devices jsonb not null default '[]'::jsonb,
  device_info jsonb not null default '{}'::jsonb,
  settings jsonb,
  last_login timestamptz,
  created_at timestamptz not null default now(),
  check ((role = 'super') = (company_id is null))
);
create index accounts_company_idx on public.accounts (company_id);

create table public.ai_usage (
  company_id text not null references public.companies(id) on delete cascade,
  month text not null,
  count integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (company_id, month)
);

create table public.login_locks (
  key text primary key,
  count integer not null default 0,
  until timestamptz
);

create table public.meta (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);

alter table public.companies enable row level security;
alter table public.projects enable row level security;
alter table public.accounts enable row level security;
alter table public.ai_usage enable row level security;
alter table public.login_locks enable row level security;
alter table public.meta enable row level security;
revoke all on public.companies, public.projects, public.accounts, public.ai_usage, public.login_locks, public.meta
  from anon, authenticated;
grant all on public.companies, public.projects, public.accounts, public.ai_usage, public.login_locks, public.meta
  to service_role;

-- ---------- field-user limit (atomic) ----------
-- Locks the company row, so two admins adding users at the same moment cannot exceed the license.
create or replace function public.enforce_user_limit() returns trigger
language plpgsql set search_path = public as $$
declare m integer; n integer;
begin
  if new.role <> 'user' or coalesce(current_setting('app.skip_limits', true), '') = 'on' then return new; end if;
  if tg_op = 'UPDATE' and old.role = 'user' and old.company_id is not distinct from new.company_id then return new; end if;
  select max_users into m from companies where id = new.company_id for update;
  select count(*) into n from accounts where company_id = new.company_id and role = 'user' and username <> new.username;
  if n >= m then raise exception 'user_limit:%', m using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger accounts_user_limit before insert or update on public.accounts
  for each row execute function public.enforce_user_limit();

-- ---------- accounts ----------
create or replace function public.acct_get(p_username text) returns jsonb
language sql stable set search_path = public as $$
  select to_jsonb(a) from accounts a where username = lower(trim(p_username));
$$;

-- p_company null lists provider admins; otherwise every account of the company.
create or replace function public.acct_list(p_company text) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at), '[]'::jsonb) from accounts a
  where (p_company is null and a.role = 'super') or a.company_id = p_company;
$$;

create or replace function public.acct_save(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare r accounts;
begin
  insert into accounts (username, role, company_id, project_id, display_name, active, salt, hash,
                        devices, device_info, settings, last_login, created_at)
  values (lower(trim(p->>'username')), p->>'role', nullif(p->>'company_id', ''), nullif(p->>'project_id', ''),
          coalesce(p->>'display_name', ''), coalesce((p->>'active')::boolean, true), p->>'salt', p->>'hash',
          coalesce(p->'devices', '[]'::jsonb), coalesce(p->'device_info', '{}'::jsonb),
          case when jsonb_typeof(p->'settings') = 'object' then p->'settings' end,
          (p->>'last_login')::timestamptz, coalesce((p->>'created_at')::timestamptz, now()))
  on conflict (username) do update set
    role = excluded.role, company_id = excluded.company_id, project_id = excluded.project_id,
    display_name = excluded.display_name, active = excluded.active, salt = excluded.salt, hash = excluded.hash,
    devices = excluded.devices, device_info = excluded.device_info, settings = excluded.settings,
    last_login = excluded.last_login
  returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public.acct_delete(p_username text) returns boolean
language sql set search_path = public as $$
  with d as (delete from accounts where username = lower(trim(p_username)) returning 1) select exists(select 1 from d);
$$;

-- Registers a device for a field user if under the limit. Returns 'ok', 'limit' or 'missing'.
create or replace function public.acct_register_device(p_username text, p_device text, p_max integer) returns text
language plpgsql set search_path = public as $$
declare d jsonb;
begin
  select devices into d from accounts where username = lower(trim(p_username)) for update;
  if not found then return 'missing'; end if;
  if d ? p_device then return 'ok'; end if;
  if jsonb_array_length(d) >= p_max then return 'limit'; end if;
  update accounts set devices = devices || to_jsonb(p_device),
    device_info = device_info || jsonb_build_object(p_device, jsonb_build_object('addedAt', now()))
  where username = lower(trim(p_username));
  return 'ok';
end $$;

-- Removes one device, or all when p_device is null.
create or replace function public.acct_remove_device(p_username text, p_device text) returns boolean
language sql set search_path = public as $$
  with u as (
    update accounts set
      devices = case when p_device is null then '[]'::jsonb else devices - p_device end,
      device_info = case when p_device is null then '{}'::jsonb else device_info - p_device end
    where username = lower(trim(p_username)) returning 1)
  select exists(select 1 from u);
$$;

-- Records that a device was seen (and a login, when p_login).
create or replace function public.acct_seen(p_username text, p_device text, p_login boolean) returns void
language sql set search_path = public as $$
  update accounts set
    last_login = case when p_login then now() else last_login end,
    device_info = case when p_device is not null and devices ? p_device
      then jsonb_set(device_info, array[p_device],
                     coalesce(device_info->p_device, '{}'::jsonb) || jsonb_build_object('lastSeen', now()))
      else device_info end
  where username = lower(trim(p_username));
$$;

-- ---------- companies ----------
create or replace function public.co_get(p_id text) returns jsonb
language sql stable set search_path = public as $$
  select to_jsonb(c) from companies c where id = p_id;
$$;

create or replace function public.co_list() returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc), '[]'::jsonb) from companies c;
$$;

create or replace function public.co_save(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare r companies;
begin
  insert into companies (id, customer, starts_at, months, expires_at, max_users, max_devices_per_user, ai_enabled,
                         ai_monthly_cap, active, contact_name, contact_phone, contact_email, notes, renewals, created_at)
  values (p->>'id', p->>'customer', (p->>'starts_at')::date, coalesce((p->>'months')::int, 12), (p->>'expires_at')::date,
          coalesce((p->>'max_users')::int, 1), coalesce((p->>'max_devices_per_user')::int, 1),
          coalesce((p->>'ai_enabled')::boolean, true), coalesce((p->>'ai_monthly_cap')::int, 0),
          coalesce((p->>'active')::boolean, true), coalesce(p->>'contact_name', ''), coalesce(p->>'contact_phone', ''),
          coalesce(p->>'contact_email', ''), coalesce(p->>'notes', ''), coalesce(p->'renewals', '[]'::jsonb),
          coalesce((p->>'created_at')::timestamptz, now()))
  on conflict (id) do update set
    customer = excluded.customer, starts_at = excluded.starts_at, months = excluded.months, expires_at = excluded.expires_at,
    max_users = excluded.max_users, max_devices_per_user = excluded.max_devices_per_user, ai_enabled = excluded.ai_enabled,
    ai_monthly_cap = excluded.ai_monthly_cap, active = excluded.active, contact_name = excluded.contact_name,
    contact_phone = excluded.contact_phone, contact_email = excluded.contact_email, notes = excluded.notes,
    renewals = excluded.renewals
  returning * into r;
  return to_jsonb(r);
end $$;

-- Refuses while the company still has accounts; its projects and usage go with it.
create or replace function public.co_delete(p_id text) returns text
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from accounts where company_id = p_id) then return 'has_users'; end if;
  delete from companies where id = p_id;
  return 'ok';
end $$;

-- ---------- projects ----------
create or replace function public.proj_get(p_company text, p_id text) returns jsonb
language sql stable set search_path = public as $$
  select to_jsonb(p) from projects p where company_id = p_company and id = p_id;
$$;

create or replace function public.proj_list(p_company text) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at), '[]'::jsonb) from projects p where company_id = p_company;
$$;

create or replace function public.proj_save(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare r projects;
begin
  insert into projects (id, company_id, name, active, notes, settings, categories, categories_updated_at, created_at)
  values (p->>'id', p->>'company_id', p->>'name', coalesce((p->>'active')::boolean, true), coalesce(p->>'notes', ''),
          coalesce(p->'settings', '{}'::jsonb), coalesce(p->'categories', '[]'::jsonb),
          (p->>'categories_updated_at')::timestamptz, coalesce((p->>'created_at')::timestamptz, now()))
  on conflict (id) do update set
    name = excluded.name, active = excluded.active, notes = excluded.notes, settings = excluded.settings,
    categories = excluded.categories, categories_updated_at = excluded.categories_updated_at
  where projects.company_id = excluded.company_id
  returning * into r;
  if r.id is null then return null; end if;
  return to_jsonb(r);
end $$;

create or replace function public.proj_delete(p_company text, p_id text) returns boolean
language sql set search_path = public as $$
  with d as (delete from projects where company_id = p_company and id = p_id returning 1) select exists(select 1 from d);
$$;

-- ---------- AI usage ----------
create or replace function public.usage_get(p_company text, p_month text) returns jsonb
language sql stable set search_path = public as $$
  select coalesce((select jsonb_build_object('count', count, 'inputTokens', input_tokens, 'outputTokens', output_tokens)
                   from ai_usage where company_id = p_company and month = p_month), jsonb_build_object('count', 0));
$$;

create or replace function public.usage_add(p_company text, p_month text, p_in bigint, p_out bigint) returns integer
language sql set search_path = public as $$
  insert into ai_usage (company_id, month, count, input_tokens, output_tokens)
  values (p_company, p_month, 1, p_in, p_out)
  on conflict (company_id, month) do update set count = ai_usage.count + 1,
    input_tokens = ai_usage.input_tokens + p_in, output_tokens = ai_usage.output_tokens + p_out
  returning count;
$$;

-- ---------- brute-force locks ----------
-- Minutes left on a lock, 0 when not locked.
create or replace function public.lock_check(p_key text) returns integer
language sql stable set search_path = public as $$
  select coalesce((select ceil(extract(epoch from (until - now())) / 60)::int from login_locks
                   where key = p_key and until > now()), 0);
$$;

-- Counts a failure; after p_max failures the key is locked for p_minutes.
create or replace function public.lock_fail(p_key text, p_max integer, p_minutes integer) returns void
language sql set search_path = public as $$
  insert into login_locks as l (key, count) values (p_key, 1)
  on conflict (key) do update set
    count = case when l.count + 1 >= p_max then 0 else l.count + 1 end,
    until = case when l.count + 1 >= p_max then now() + make_interval(mins => p_minutes) else l.until end;
$$;

create or replace function public.lock_clear(p_key text) returns void
language sql set search_path = public as $$
  delete from login_locks where key = p_key;
$$;

-- ---------- meta ----------
create or replace function public.meta_get(p_key text) returns jsonb
language sql stable set search_path = public as $$
  select value from meta where key = p_key;
$$;
create or replace function public.meta_set(p_key text, p_value jsonb) returns void
language sql set search_path = public as $$
  insert into meta (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value, updated_at = now();
$$;

-- ---------- one-time import from Netlify Blobs ----------
-- Idempotent: existing rows are never overwritten. License limits are not re-checked for imported data.
create or replace function public.import_legacy(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare nc int; np int; na int; nu int;
begin
  perform set_config('app.skip_limits', 'on', true);
  insert into companies (id, customer, starts_at, months, expires_at, max_users, max_devices_per_user, ai_enabled,
                         ai_monthly_cap, active, contact_name, contact_phone, contact_email, notes, renewals, created_at)
  select x->>'id', coalesce(x->>'customer', x->>'id'), (x->>'starts_at')::date, coalesce((x->>'months')::int, 12),
         (x->>'expires_at')::date, greatest(1, coalesce((x->>'max_users')::int, 1)),
         greatest(1, coalesce((x->>'max_devices_per_user')::int, 1)), coalesce((x->>'ai_enabled')::boolean, true),
         coalesce((x->>'ai_monthly_cap')::int, 0), coalesce((x->>'active')::boolean, true),
         coalesce(x->>'contact_name', ''), coalesce(x->>'contact_phone', ''), coalesce(x->>'contact_email', ''),
         coalesce(x->>'notes', ''), coalesce(x->'renewals', '[]'::jsonb), coalesce((x->>'created_at')::timestamptz, now())
  from jsonb_array_elements(coalesce(p->'companies', '[]'::jsonb)) x
  where x->>'id' is not null
  on conflict (id) do nothing;
  get diagnostics nc = row_count;

  insert into projects (id, company_id, name, active, notes, settings, categories, categories_updated_at, created_at)
  select x->>'id', x->>'company_id', coalesce(x->>'name', 'مشروع'), coalesce((x->>'active')::boolean, true),
         coalesce(x->>'notes', ''), coalesce(x->'settings', '{}'::jsonb), coalesce(x->'categories', '[]'::jsonb),
         (x->>'categories_updated_at')::timestamptz, coalesce((x->>'created_at')::timestamptz, now())
  from jsonb_array_elements(coalesce(p->'projects', '[]'::jsonb)) x
  where x->>'id' is not null and exists (select 1 from companies c where c.id = x->>'company_id')
  on conflict (id) do nothing;
  get diagnostics np = row_count;

  insert into accounts (username, role, company_id, project_id, display_name, active, salt, hash,
                        devices, device_info, settings, last_login, created_at)
  select lower(trim(x->>'username')), x->>'role', x->>'company_id',
         case when exists (select 1 from projects pr where pr.id = x->>'project_id' and pr.company_id = x->>'company_id')
              then x->>'project_id' end,
         coalesce(x->>'display_name', ''), coalesce((x->>'active')::boolean, true), x->>'salt', x->>'hash',
         coalesce(x->'devices', '[]'::jsonb), coalesce(x->'device_info', '{}'::jsonb),
         case when jsonb_typeof(x->'settings') = 'object' then x->'settings' end,
         (x->>'last_login')::timestamptz, coalesce((x->>'created_at')::timestamptz, now())
  from jsonb_array_elements(coalesce(p->'accounts', '[]'::jsonb)) x
  where x->>'username' is not null and x->>'salt' is not null and x->>'hash' is not null
    and x->>'role' in ('user', 'admin')
    and exists (select 1 from companies c where c.id = x->>'company_id')
  on conflict (username) do nothing;
  get diagnostics na = row_count;

  insert into ai_usage (company_id, month, count, input_tokens, output_tokens)
  select x->>'company_id', x->>'month', coalesce((x->>'count')::int, 0),
         coalesce((x->>'input_tokens')::bigint, 0), coalesce((x->>'output_tokens')::bigint, 0)
  from jsonb_array_elements(coalesce(p->'usage', '[]'::jsonb)) x
  where exists (select 1 from companies c where c.id = x->>'company_id')
  on conflict (company_id, month) do nothing;
  get diagnostics nu = row_count;

  return jsonb_build_object('companies', nc, 'projects', np, 'accounts', na, 'usage', nu);
end $$;

-- Close every function to the public API; only the server's service role may call them.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'enforce_user_limit', 'acct_get', 'acct_list', 'acct_save', 'acct_delete', 'acct_register_device',
      'acct_remove_device', 'acct_seen', 'co_get', 'co_list', 'co_save', 'co_delete', 'proj_get', 'proj_list',
      'proj_save', 'proj_delete', 'usage_get', 'usage_add', 'lock_check', 'lock_fail', 'lock_clear',
      'meta_get', 'meta_set', 'import_legacy')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
