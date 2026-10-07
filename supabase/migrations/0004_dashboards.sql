-- v2.5: numbers for the provider and company dashboards. Read-only functions; nothing is changed or deleted.
-- Days are counted in Riyadh time.

-- Provider: assets recorded per day, per company totals, AI requests per month.
create or replace function public.dash_provider(p_days integer) returns jsonb
language sql stable set search_path = public as $$
  with a as (
    select company_id, (coalesce(created_at, synced_at) at time zone 'Asia/Riyadh')::date d, synced_at
    from public.assets where not flagged
  ),
  days as (
    select generate_series((now() at time zone 'Asia/Riyadh')::date - (least(greatest(p_days, 7), 90) - 1),
                           (now() at time zone 'Asia/Riyadh')::date, interval '1 day')::date d
  )
  select jsonb_build_object(
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', days.d, 'assets', coalesce(x.c, 0)) order by days.d), '[]'::jsonb)
              from days left join (select d, count(*) c from a group by d) x on x.d = days.d),
    'perCompany', (select coalesce(jsonb_agg(jsonb_build_object(
                     'companyId', company_id, 'assets', c, 'week', w, 'today', t, 'lastSync', ls)), '[]'::jsonb)
                   from (select company_id, count(*) c,
                                count(*) filter (where d > (now() at time zone 'Asia/Riyadh')::date - 7) w,
                                count(*) filter (where d = (now() at time zone 'Asia/Riyadh')::date) t,
                                max(synced_at) ls
                         from a group by company_id) y),
    'aiMonths', (select coalesce(jsonb_agg(jsonb_build_object('month', month, 'count', c, 'inputTokens', i, 'outputTokens', o) order by month), '[]'::jsonb)
                 from (select month, sum(count) c, sum(input_tokens) i, sum(output_tokens) o
                       from public.ai_usage group by month order by month desc limit 12) z),
    'flagged', (select count(*) from public.assets where flagged)
  );
$$;

-- Company admin: per day, per project, per field user (today / last 7 days / all), and per building.
create or replace function public.dash_company(p_company text, p_days integer) returns jsonb
language sql stable set search_path = public as $$
  with a as (
    select project_id, username, flagged, data, synced_at,
           (coalesce(created_at, synced_at) at time zone 'Asia/Riyadh')::date d
    from public.assets where company_id = p_company
  ),
  today as (select (now() at time zone 'Asia/Riyadh')::date t),
  days as (
    select generate_series((select t from today) - (least(greatest(p_days, 7), 90) - 1), (select t from today), interval '1 day')::date d
  )
  select jsonb_build_object(
    'total', (select count(*) from a where not flagged),
    'flagged', (select count(*) from a where flagged),
    'today', (select count(*) from a, today where not flagged and d = today.t),
    'week', (select count(*) from a, today where not flagged and d > today.t - 7),
    'lastSync', (select max(synced_at) from a),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', days.d, 'assets', coalesce(x.c, 0)) order by days.d), '[]'::jsonb)
              from days left join (select d, count(*) c from a where not flagged group by d) x on x.d = days.d),
    'perProject', (select coalesce(jsonb_agg(jsonb_build_object('projectId', project_id, 'assets', c, 'flagged', f, 'week', w, 'lastSync', ls)), '[]'::jsonb)
                   from (select project_id, count(*) filter (where not flagged) c, count(*) filter (where flagged) f,
                                count(*) filter (where not flagged and d > (select t from today) - 7) w, max(synced_at) ls
                         from a group by project_id) p),
    'perUser', (select coalesce(jsonb_agg(jsonb_build_object('username', username, 'today', td, 'week', w, 'total', c, 'lastSync', ls) order by w desc, c desc), '[]'::jsonb)
                from (select username, count(*) c,
                             count(*) filter (where d = (select t from today)) td,
                             count(*) filter (where d > (select t from today) - 7) w, max(synced_at) ls
                      from a where not flagged group by username) u)
  );
$$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('dash_provider', 'dash_company')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
