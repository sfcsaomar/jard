-- Inventory assets synced from the field app (applied 2026-10-07).
create table public.assets (
  uid text primary key,
  company_id text not null,
  project_id text not null,
  username text not null,
  device_id text,
  tag text not null default '',
  data jsonb not null default '{}'::jsonb,
  photos text[] not null default '{}',
  label text,
  flagged boolean not null default false,
  created_at timestamptz,
  client_updated_at timestamptz not null,
  synced_at timestamptz not null default now()
);
create index assets_company_project_idx on public.assets (company_id, project_id);
create index assets_project_tag_idx on public.assets (company_id, project_id, tag);
alter table public.assets enable row level security;
revoke all on public.assets from anon, authenticated;

create or replace function public.upsert_assets(p_company text, p_project text, p_user text, p_device text, p_rows jsonb)
returns integer language plpgsql set search_path = public as $$
declare n integer;
begin
  insert into public.assets as a (uid, company_id, project_id, username, device_id, tag, data, photos, label, flagged, created_at, client_updated_at, synced_at)
  select r->>'uid', p_company, p_project, p_user, p_device, coalesce(r->>'tag', ''), coalesce(r->'data', '{}'::jsonb),
         coalesce(array(select jsonb_array_elements_text(coalesce(r->'photos', '[]'::jsonb))), '{}'),
         nullif(r->>'label', ''), coalesce((r->>'flagged')::boolean, false),
         to_timestamp((r->>'createdAt')::double precision / 1000), to_timestamp((r->>'updatedAt')::double precision / 1000), now()
  from jsonb_array_elements(p_rows) r
  on conflict (uid) do update set
    tag = excluded.tag, data = excluded.data, photos = excluded.photos, label = excluded.label,
    flagged = excluded.flagged, username = excluded.username, device_id = excluded.device_id,
    client_updated_at = excluded.client_updated_at, synced_at = now()
  where a.company_id = excluded.company_id and excluded.client_updated_at >= a.client_updated_at;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.project_stats(p_company text, p_project text)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'total', count(*) filter (where not flagged),
    'flagged', count(*) filter (where flagged),
    'photos', coalesce(sum(cardinality(photos) + (label is not null)::int), 0),
    'lastSync', max(synced_at),
    'byUser', coalesce((select jsonb_agg(jsonb_build_object('username', x.username, 'count', x.c, 'lastSync', x.ls) order by x.c desc) from (
        select username, count(*) c, max(synced_at) ls
        from public.assets where company_id = p_company and project_id = p_project and not flagged group by username) x), '[]'::jsonb),
    'byBuilding', coalesce((select jsonb_agg(jsonb_build_object('building', y.b, 'count', y.c) order by y.b) from (
        select coalesce(nullif(data->>'building',''), '—') b, count(*) c
        from public.assets where company_id = p_company and project_id = p_project and not flagged
        group by coalesce(nullif(data->>'building',''), '—')) y), '[]'::jsonb)
  )
  from public.assets where company_id = p_company and project_id = p_project;
$$;

create or replace function public.company_counts(p_company text)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_object_agg(project_id, c), '{}'::jsonb)
  from (select project_id, count(*) c from public.assets where company_id = p_company group by project_id) t;
$$;

create or replace function public.list_assets(p_company text, p_project text, p_q text, p_limit integer, p_offset integer)
returns jsonb language sql stable set search_path = public as $$
  with f as (
    select * from public.assets
    where company_id = p_company and project_id = p_project
      and (coalesce(p_q, '') = '' or tag ilike '%' || p_q || '%' or data->>'name' ilike '%' || p_q || '%'
           or data->>'sn' ilike '%' || p_q || '%' or data->>'location' ilike '%' || p_q || '%'
           or data->>'building' ilike '%' || p_q || '%' or username ilike '%' || p_q || '%')
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'uid', uid, 'tag', tag, 'data', data, 'photos', photos, 'label', label, 'flagged', flagged,
        'username', username, 'createdAt', created_at, 'syncedAt', synced_at) order by tag, uid)
      from (select * from f order by tag, uid limit least(greatest(p_limit, 1), 2000) offset greatest(p_offset, 0)) p), '[]'::jsonb)
  );
$$;

revoke execute on function public.upsert_assets(text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.project_stats(text, text) from public, anon, authenticated;
revoke execute on function public.company_counts(text) from public, anon, authenticated;
revoke execute on function public.list_assets(text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.upsert_assets(text, text, text, text, jsonb) to service_role;
grant execute on function public.project_stats(text, text) to service_role;
grant execute on function public.company_counts(text) to service_role;
grant execute on function public.list_assets(text, text, text, integer, integer) to service_role;
grant all on public.assets to service_role;

-- Private bucket for photos and thumbnails (Supabase storage).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
