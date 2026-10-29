-- Fitness app: one-time setup. Paste into Supabase → SQL Editor → Run.
-- Safe to run again (it updates things in place).
-- Everything is locked down: the app's API key alone can't read or write your data;
-- every call must also carry your private sync token.

create table if not exists fit_secret (id int primary key default 1 check (id = 1), token text not null);
insert into fit_secret (id, token) values (1, '__TOKEN__')
  on conflict (id) do update set token = excluded.token;

create table if not exists fit_health (
  day date primary key,
  steps numeric, distance_mi numeric, active_kcal numeric, resting_hr numeric,
  sleep_min numeric, bed_at timestamptz, wake_at timestamptz,
  updated_at timestamptz not null default now());
-- added later: whether a night's sleep came from real sleep tracking or only "In Bed" time
alter table fit_health add column if not exists sleep_kind text;
create table if not exists fit_weight (
  at timestamptz primary key, lb numeric not null, source text not null default 'health');
create table if not exists fit_backup (
  id int primary key default 1 check (id = 1), data jsonb not null, updated_at timestamptz not null default now());

alter table fit_secret enable row level security;
alter table fit_health enable row level security;
alter table fit_weight enable row level security;
alter table fit_backup enable row level security;
revoke all on fit_secret, fit_health, fit_weight, fit_backup from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on fit_secret, fit_health, fit_weight, fit_backup from anon, authenticated';
  end if;
end $$;

-- helpers (not callable from outside)
create or replace function fit_ok(p_token text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from fit_secret where token = p_token and length(p_token) >= 24) $$;

create or replace function fit_num(t text) returns numeric
  language sql immutable set search_path = public as $$
  select (substring(replace(coalesce(t, ''), ',', '') from '-?[0-9]+(?:\.[0-9]+)?'))::numeric $$;

-- Called by the Apple Shortcut. Every field is optional text, exactly as Shortcuts sends it.
create or replace function fit_push(
  token text, day text default null, steps text default null, distance text default null,
  active text default null, resting_hr text default null, weight text default null,
  weight_at text default null, sleep text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  d date; s_min numeric; s_bed timestamptz; s_wake timestamptz; s_kind text; w numeric; dist numeric;
begin
  if not fit_ok(token) then raise exception 'Wrong sync token'; end if;
  -- the day must come from the phone; the database's own clock is UTC and can be a day ahead in the evening
  if coalesce(trim(day), '') = '' then raise exception 'Missing day: check the Format Date action in the Shortcut'; end if;
  d := trim(day)::date;

  if coalesce(sleep, '') <> '' then
    with parts as (
      select lower(trim(split_part(x, ';', 1))) v,
             nullif(trim(split_part(x, ';', 2)), '')::timestamptz s,
             nullif(trim(split_part(x, ';', 3)), '')::timestamptz e
      from unnest(string_to_array(sleep, '|')) x where trim(x) <> ''),
    asleep as (
      select tstzrange(s, e) r from parts
      where s is not null and e > s and v not like '%awake%' and v not like '%bed%'),
    inbed as (
      select tstzrange(s, e) r from parts
      where s is not null and e > s and v like '%bed%'),
    -- real sleep stages (watch or sleep app) win; without them, use the iPhone's "In Bed" time
    pick as (
      select r, 'asleep' k from asleep
      union all
      select r, 'inbed' k from inbed where not exists (select 1 from asleep)),
    merged as (select unnest(range_agg(r)) r from pick)   -- overlapping samples count once
    select (select sum(extract(epoch from upper(r) - lower(r))) / 60 from merged),
           (select min(lower(r)) from merged),
           (select max(upper(r)) from merged),
           (select min(k) from pick)
      into s_min, s_bed, s_wake, s_kind;
  end if;

  dist := fit_num(distance);
  if distance ilike '%km%' then dist := dist * 0.621371; end if;

  insert into fit_health as h (day, steps, distance_mi, active_kcal, resting_hr, sleep_min, bed_at, wake_at, sleep_kind, updated_at)
  values (d, fit_num(steps), dist, fit_num(active), fit_num(resting_hr), s_min, s_bed, s_wake, s_kind, now())
  on conflict on constraint fit_health_pkey do update set
    -- running totals only grow during the day, so keep the larger number
    steps = greatest(h.steps, excluded.steps),
    distance_mi = greatest(h.distance_mi, excluded.distance_mi),
    active_kcal = greatest(h.active_kcal, excluded.active_kcal),
    resting_hr = coalesce(excluded.resting_hr, h.resting_hr),
    -- a later run can see only part of last night; keep the fuller night
    sleep_min = case when excluded.sleep_min is not null and excluded.sleep_min >= coalesce(h.sleep_min, 0) then excluded.sleep_min else h.sleep_min end,
    bed_at = case when excluded.sleep_min is not null and excluded.sleep_min >= coalesce(h.sleep_min, 0) then excluded.bed_at else h.bed_at end,
    wake_at = case when excluded.sleep_min is not null and excluded.sleep_min >= coalesce(h.sleep_min, 0) then excluded.wake_at else h.wake_at end,
    sleep_kind = case when excluded.sleep_min is not null and excluded.sleep_min >= coalesce(h.sleep_min, 0) then excluded.sleep_kind else h.sleep_kind end,
    updated_at = now();

  w := fit_num(weight);
  if w is not null and w > 0 then
    if weight ilike '%kg%' then w := round(w * 2.20462, 1); end if;
    insert into fit_weight (at, lb, source)
      values (coalesce(nullif(trim(weight_at), '')::timestamptz, now()), w, 'health')
      on conflict (at) do nothing;
  end if;

  -- the app only keeps the current year
  delete from fit_health where fit_health.day < date_trunc('year', current_date)::date;
  delete from fit_weight where fit_weight.at < date_trunc('year', now());
  return 'ok';
end $$;

create or replace function fit_get(token text, since date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f date := coalesce(since, date_trunc('year', current_date)::date);
begin
  if not fit_ok(token) then raise exception 'Wrong sync token'; end if;
  return jsonb_build_object(
    'days', coalesce((select jsonb_agg(to_jsonb(h) order by h.day) from fit_health h where h.day >= f), '[]'::jsonb),
    'weights', coalesce((select jsonb_agg(jsonb_build_object('at', w.at, 'lb', w.lb, 'source', w.source) order by w.at)
                         from fit_weight w where w.at >= f), '[]'::jsonb));
end $$;

create or replace function fit_add_weight(token text, at timestamptz, lb numeric)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not fit_ok(token) then raise exception 'Wrong sync token'; end if;
  insert into fit_weight (at, lb, source) values (at, lb, 'manual')
    on conflict on constraint fit_weight_pkey do update set lb = excluded.lb, source = 'manual';
  return 'ok';
end $$;

create or replace function fit_del_weight(token text, at timestamptz)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not fit_ok(token) then raise exception 'Wrong sync token'; end if;
  delete from fit_weight w where w.at = fit_del_weight.at;
  return 'ok';
end $$;

create or replace function fit_save_backup(token text, data jsonb)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare t timestamptz := now();
begin
  if not fit_ok(token) then raise exception 'Wrong sync token'; end if;
  insert into fit_backup (id, data, updated_at) values (1, data, t)
    on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at;
  return t;
end $$;

create or replace function fit_load_backup(token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not fit_ok(token) then raise exception 'Wrong sync token'; end if;
  return (select jsonb_build_object('data', b.data, 'updated_at', b.updated_at) from fit_backup b where b.id = 1);
end $$;

create or replace function fit_ping(token text)
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if not fit_ok(token) then raise exception 'Wrong sync token'; end if;
  return 'ok';
end $$;

revoke all on function fit_ok(text), fit_num(text) from public;
grant execute on function fit_push(text, text, text, text, text, text, text, text, text), fit_get(text, date),
  fit_add_weight(text, timestamptz, numeric), fit_del_weight(text, timestamptz),
  fit_save_backup(text, jsonb), fit_load_backup(text), fit_ping(text) to public;

notify pgrst, 'reload schema';
