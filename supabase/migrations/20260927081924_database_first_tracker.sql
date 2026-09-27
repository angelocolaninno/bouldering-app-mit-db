-- All user data is read and changed through authenticated, invoker-rights RPCs.
-- Existing tables are retained; the IF NOT EXISTS definitions also support a new project.
create table if not exists public.check_ins (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  date date not null, year smallint not null, level text not null default 'normal',
  created_at timestamptz default now(), constraint check_ins_user_date unique (user_id, date)
);
create table if not exists public.routes (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  date date not null, year smallint not null,
  y smallint default 0, g smallint default 0, o smallint default 0, b smallint default 0,
  r smallint default 0, w smallint default 0, bl smallint default 0, p smallint default 0,
  created_at timestamptz default now(), constraint routes_user_date unique (user_id, date)
);
create table if not exists public.buddy_weeks (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  week_key text not null, constraint buddy_weeks_user_week unique (user_id, week_key)
);
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id), goal smallint not null default 40,
  accent text not null default '#6b6862', buddy_name text default 'Kollegin', updated_at timestamptz default now()
);
alter table public.user_settings add column if not exists onboarded boolean not null default false;

create table public.activity_types (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,200}$'),
  label text not null check (char_length(btrim(label)) between 1 and 100),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
create table public.activity_logs (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null check (date between date '1900-01-01' and date '9999-12-31'),
  type_id text not null,
  primary key (user_id, date, type_id),
  foreign key (user_id, type_id) references public.activity_types(user_id, id) on delete cascade
);
create index activity_logs_type_idx on public.activity_logs (user_id, type_id);

alter table public.check_ins enable row level security;
alter table public.routes enable row level security;
alter table public.buddy_weeks enable row level security;
alter table public.user_settings enable row level security;
alter table public.activity_types enable row level security;
alter table public.activity_logs enable row level security;

drop policy if exists "own check_ins" on public.check_ins;
create policy "own check_ins" on public.check_ins for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "own routes" on public.routes;
create policy "own routes" on public.routes for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "own buddy_weeks" on public.buddy_weeks;
create policy "own buddy_weeks" on public.buddy_weeks for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "own settings" on public.user_settings;
create policy "own settings" on public.user_settings for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own activity_types" on public.activity_types for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own activity_logs" on public.activity_logs for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.check_ins, public.routes, public.buddy_weeks, public.user_settings,
  public.activity_types, public.activity_logs from anon, public;
grant select, insert, update, delete on public.check_ins, public.routes, public.buddy_weeks,
  public.user_settings, public.activity_types, public.activity_logs to authenticated;

-- Validation helpers are deliberately outside the exposed public schema.
create schema if not exists sammelbuch_private;
revoke all on schema sammelbuch_private from public, anon;
grant usage on schema sammelbuch_private to authenticated;

create function sammelbuch_private.checked_date(value jsonb) returns date
language plpgsql immutable security invoker set search_path = '' as $$
declare result date;
begin
  if jsonb_typeof(value) is distinct from 'string' or (value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Ungültiges Datum' using errcode = '22023';
  end if;
  result := (value #>> '{}')::date;
  if result not between date '1900-01-01' and date '9999-12-31' then
    raise exception 'Datum ausserhalb des erlaubten Bereichs' using errcode = '22023';
  end if;
  return result;
end $$;

create function sammelbuch_private.checked_integer(value jsonb, minimum integer, maximum integer) returns integer
language plpgsql immutable security invoker set search_path = '' as $$
declare result numeric;
begin
  if jsonb_typeof(value) is distinct from 'number' then
    raise exception 'Eine ganze Zahl ist erforderlich' using errcode = '22023';
  end if;
  result := (value #>> '{}')::numeric;
  if result != trunc(result) or result not between minimum and maximum then
    raise exception 'Zahl ausserhalb des erlaubten Bereichs: % bis %', minimum, maximum using errcode = '22023';
  end if;
  return result::integer;
end $$;

create function sammelbuch_private.checked_color(value jsonb) returns text
language plpgsql immutable security invoker set search_path = '' as $$
declare result text := value #>> '{}';
begin
  if jsonb_typeof(value) is distinct from 'string' or result !~ '^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$' then
    raise exception 'Ungültige Farbe' using errcode = '22023';
  end if;
  if char_length(result) = 4 then
    result := '#' || repeat(substr(result,2,1),2) || repeat(substr(result,3,1),2) || repeat(substr(result,4,1),2);
  end if;
  return lower(result);
end $$;

create function sammelbuch_private.checked_week(value jsonb) returns text
language plpgsql immutable security invoker set search_path = '' as $$
declare result text := value #>> '{}';
begin
  if jsonb_typeof(value) is distinct from 'string' or result !~ '^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$' or left(result,4)::integer < 1900 then
    raise exception 'Ungültige Kalenderwoche' using errcode = '22023';
  end if;
  if to_char(to_date(result || '-1','IYYY-"W"IW-ID'),'IYYY-"W"IW') != result then
    raise exception 'Kalenderwoche existiert nicht' using errcode = '22023';
  end if;
  return result;
end $$;

create function sammelbuch_private.checked_settings(value jsonb) returns jsonb
language plpgsql immutable security invoker set search_path = '' as $$
begin
  if jsonb_typeof(value) is distinct from 'object' or
     exists (select 1 from jsonb_object_keys(value) k where k not in ('goal','accent','buddy_name','onboarded')) then
    raise exception 'Ungültige Einstellungen' using errcode = '22023';
  end if;
  if value ? 'goal' then perform sammelbuch_private.checked_integer(value->'goal', 1, 10000); end if;
  if value ? 'accent' then value := jsonb_set(value,'{accent}',to_jsonb(sammelbuch_private.checked_color(value->'accent'))); end if;
  if value ? 'buddy_name' and (jsonb_typeof(value->'buddy_name') is distinct from 'string' or char_length(value->>'buddy_name') > 100) then
    raise exception 'Ungültiger Buddy-Name' using errcode = '22023';
  end if;
  if value ? 'onboarded' and jsonb_typeof(value->'onboarded') is distinct from 'boolean' then
    raise exception 'Ungültiger Einrichtungsstatus' using errcode = '22023';
  end if;
  return value;
end $$;

create function public.sammelbuch_snapshot(expected_user_id uuid default null) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare owner_id uuid := auth.uid(); result jsonb;
begin
  if owner_id is null then raise exception 'Anmeldung erforderlich' using errcode = '42501'; end if;
  if expected_user_id is not null and expected_user_id is distinct from owner_id then
    raise exception 'Das angemeldete Konto hat sich geändert. Bitte neu laden.' using errcode = '42501';
  end if;
  -- One SELECT gives a consistent snapshot across all years and tables.
  select jsonb_build_object(
    'checkins', coalesce((select jsonb_agg(jsonb_build_object('date', c.date, 'level', c.level) order by c.date)
      from public.check_ins c where c.user_id = owner_id), '[]'::jsonb),
    'routes', coalesce((select jsonb_agg(jsonb_build_object('date', r.date, 'y', coalesce(r.y,0), 'g', coalesce(r.g,0),
      'o', coalesce(r.o,0), 'b', coalesce(r.b,0), 'r', coalesce(r.r,0), 'w', coalesce(r.w,0), 'bl', coalesce(r.bl,0), 'p', coalesce(r.p,0)) order by r.date)
      from public.routes r where r.user_id = owner_id), '[]'::jsonb),
    'buddyWeeks', coalesce((select jsonb_agg(b.week_key order by b.week_key) from public.buddy_weeks b where b.user_id = owner_id), '[]'::jsonb),
    'settings', (select jsonb_build_object('goal', s.goal, 'accent', s.accent, 'buddy_name', coalesce(s.buddy_name,''), 'onboarded', s.onboarded)
      from public.user_settings s where s.user_id = owner_id),
    'activityTypes', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'label', t.label, 'color', t.color) order by t.created_at, t.id)
      from public.activity_types t where t.user_id = owner_id), '[]'::jsonb),
    'activities', coalesce((select jsonb_agg(jsonb_build_object('date', a.date, 'typeId', a.type_id) order by a.date, a.type_id)
      from public.activity_logs a where a.user_id = owner_id), '[]'::jsonb)
  ) into result;
  return result;
end $$;

create function public.sammelbuch_mutate(command jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid(); mode text; item jsonb; data jsonb; patch jsonb;
  day date; yr integer; lv text; enabled boolean; col text; amount integer;
  week text; type_key text; type_label text; type_color text; matched_id text;
  type_map jsonb := '{}'::jsonb; normalized_label text; field text;
begin
  if owner_id is null then raise exception 'Anmeldung erforderlich' using errcode = '42501'; end if;
  if jsonb_typeof(command) is distinct from 'object' or jsonb_typeof(command->'kind') is distinct from 'string' then
    raise exception 'Ungültiger Speicherauftrag' using errcode = '22023';
  end if;
  if jsonb_typeof(command->'expectedUserId') is distinct from 'string' or command->>'expectedUserId' is distinct from owner_id::text then
    raise exception 'Das angemeldete Konto hat sich geändert. Bitte neu laden.' using errcode = '42501';
  end if;
  mode := command->>'kind';
  -- Serializes this account's writes, including imports and deletes, across devices.
  perform pg_advisory_xact_lock(hashtextextended('sammelbuch:' || owner_id::text, 0));

  if mode in ('checkin','level','route','activity') then
    day := sammelbuch_private.checked_date(command->'date'); yr := extract(year from day)::integer;
  end if;
  if mode in ('checkin','buddy','activity') then
    if jsonb_typeof(command->'on') is distinct from 'boolean' then
      raise exception 'Ein/Aus muss ein Wahrheitswert sein' using errcode = '22023';
    end if;
    enabled := (command->>'on')::boolean;
  end if;
  if mode in ('checkin','level') then
    lv := coalesce(command->>'level','normal');
    if (mode = 'level' and not command ? 'level') or (command ? 'level' and jsonb_typeof(command->'level') is distinct from 'string') or lv not in ('leicht','normal','stark') then
      raise exception 'Ungültige Intensität' using errcode = '22023';
    end if;
  end if;

  case mode
  when 'checkin' then
    if enabled then
      insert into public.check_ins(user_id,date,year,level) values(owner_id,day,yr,lv)
      on conflict (user_id,date) do update set level = case when command ? 'level' then excluded.level else check_ins.level end;
    else
      delete from public.routes where user_id = owner_id and date = day;
      delete from public.check_ins where user_id = owner_id and date = day;
    end if;
  when 'level' then
    update public.check_ins set level = lv where user_id = owner_id and date = day;
    if not found then raise exception 'Bitte zuerst den Boulderbesuch eintragen' using errcode = '22023'; end if;
  when 'route' then
    col := command->>'color'; amount := sammelbuch_private.checked_integer(command->'value',0,3);
    if col is null or col not in ('y','g','o','b','r','w','bl','p') then raise exception 'Ungültige Routenfarbe' using errcode = '22023'; end if;
    if not exists (select 1 from public.check_ins where user_id = owner_id and date = day) then
      raise exception 'Bitte zuerst den Boulderbesuch eintragen' using errcode = '22023';
    end if;
    insert into public.routes(user_id,date,year) values(owner_id,day,yr) on conflict (user_id,date) do nothing;
    execute format('update public.routes set %I = $1 where user_id = $2 and date = $3', col) using amount,owner_id,day;
  when 'buddy' then
    week := sammelbuch_private.checked_week(command->'week');
    if enabled then
      insert into public.buddy_weeks(user_id,week_key) values(owner_id,week) on conflict (user_id,week_key) do nothing;
    else delete from public.buddy_weeks where user_id = owner_id and week_key = week; end if;
  when 'settings' then
    patch := sammelbuch_private.checked_settings(command->'patch');
    insert into public.user_settings(user_id,buddy_name) values(owner_id,'') on conflict (user_id) do nothing;
    update public.user_settings set
      goal = case when patch ? 'goal' then (patch->>'goal')::numeric::smallint else goal end,
      accent = case when patch ? 'accent' then patch->>'accent' else accent end,
      buddy_name = case when patch ? 'buddy_name' then patch->>'buddy_name' else buddy_name end,
      onboarded = case when patch ? 'onboarded' then (patch->>'onboarded')::boolean else onboarded end,
      updated_at = now()
    where user_id = owner_id;
  when 'type_upsert' then
    type_key := command->>'id'; type_label := btrim(command->>'label'); type_color := sammelbuch_private.checked_color(command->'color');
    if jsonb_typeof(command->'id') is distinct from 'string' or type_key !~ '^[A-Za-z0-9_-]{1,200}$' or
       jsonb_typeof(command->'label') is distinct from 'string' or char_length(type_label) not between 1 and 100 or
       jsonb_typeof(command->'color') is distinct from 'string' or type_color !~ '^#[0-9A-Fa-f]{6}$' then
      raise exception 'Ungültige Aktivität: Name, Kennung oder Farbe' using errcode = '22023';
    end if;
    insert into public.activity_types(user_id,id,label,color) values(owner_id,type_key,type_label,type_color)
    on conflict (user_id,id) do update set label = excluded.label, color = excluded.color;
  when 'type_delete' then
    type_key := command->>'id';
    if jsonb_typeof(command->'id') is distinct from 'string' or type_key !~ '^[A-Za-z0-9_-]{1,200}$' then
      raise exception 'Ungültige Aktivitätskennung' using errcode = '22023';
    end if;
    delete from public.activity_types where user_id = owner_id and id = type_key;
  when 'activity' then
    type_key := command->>'typeId';
    if jsonb_typeof(command->'typeId') is distinct from 'string' or type_key !~ '^[A-Za-z0-9_-]{1,200}$' then
      raise exception 'Ungültige Aktivitätskennung' using errcode = '22023';
    end if;
    if enabled then
      insert into public.activity_logs(user_id,date,type_id) values(owner_id,day,type_key) on conflict do nothing;
    else delete from public.activity_logs where user_id = owner_id and date = day and type_id = type_key; end if;
  when 'reset_year' then
    yr := sammelbuch_private.checked_integer(command->'year',1900,9999);
    delete from public.routes where user_id = owner_id and date >= make_date(yr,1,1) and date <= make_date(yr,12,31);
    delete from public.check_ins where user_id = owner_id and date >= make_date(yr,1,1) and date <= make_date(yr,12,31);
    delete from public.buddy_weeks where user_id = owner_id and week_key like yr::text || '-W%';
    delete from public.activity_logs where user_id = owner_id and date >= make_date(yr,1,1) and date <= make_date(yr,12,31);
  when 'import' then
    data := command->'data';
    if jsonb_typeof(data) is distinct from 'object' then raise exception 'Ungültiges Backup' using errcode = '22023'; end if;
    foreach field in array array['checkins','routes','buddyWeeks','activityTypes','activities'] loop
      if data ? field and jsonb_typeof(data->field) is distinct from 'array' then raise exception 'Ungültiges Backup-Feld: %', field using errcode = '22023'; end if;
      if jsonb_array_length(coalesce(data->field,'[]'::jsonb)) > 100000 then raise exception 'Backup zu gross' using errcode = '22023'; end if;
    end loop;
    -- A single transaction means any invalid item rolls back the entire import.
    for item in select value from jsonb_array_elements(coalesce(data->'checkins','[]'::jsonb)) loop
      if jsonb_typeof(item) is distinct from 'object' then raise exception 'Ungültiger Besuch' using errcode = '22023'; end if;
      day := sammelbuch_private.checked_date(item->'date'); lv := coalesce(item->>'level','normal');
      if (item ? 'level' and jsonb_typeof(item->'level') is distinct from 'string') or lv not in ('leicht','normal','stark') then
        raise exception 'Ungültige Intensität' using errcode = '22023';
      end if;
      insert into public.check_ins(user_id,date,year,level) values(owner_id,day,extract(year from day),lv) on conflict (user_id,date) do nothing;
    end loop;
    for item in select value from jsonb_array_elements(coalesce(data->'routes','[]'::jsonb)) loop
      if jsonb_typeof(item) is distinct from 'object' then raise exception 'Ungültige Routen' using errcode = '22023'; end if;
      day := sammelbuch_private.checked_date(item->'date');
      foreach col in array array['y','g','o','b','r','w','bl','p'] loop
        perform sammelbuch_private.checked_integer(coalesce(item->col,'0'::jsonb),0,3);
      end loop;
      -- Old backups can contain routes without a check-in. Preserve those records.
      insert into public.routes(user_id,date,year,y,g,o,b,r,w,bl,p) values(owner_id,day,extract(year from day),
        coalesce((item->>'y')::numeric::smallint,0),coalesce((item->>'g')::numeric::smallint,0),coalesce((item->>'o')::numeric::smallint,0),coalesce((item->>'b')::numeric::smallint,0),
        coalesce((item->>'r')::numeric::smallint,0),coalesce((item->>'w')::numeric::smallint,0),coalesce((item->>'bl')::numeric::smallint,0),coalesce((item->>'p')::numeric::smallint,0))
      on conflict (user_id,date) do nothing;
    end loop;
    for item in select value from jsonb_array_elements(coalesce(data->'buddyWeeks','[]'::jsonb)) loop
      week := sammelbuch_private.checked_week(item);
      insert into public.buddy_weeks(user_id,week_key) values(owner_id,week) on conflict (user_id,week_key) do nothing;
    end loop;
    for item in select value from jsonb_array_elements(coalesce(data->'activityTypes','[]'::jsonb)) loop
      if jsonb_typeof(item) is distinct from 'object' then raise exception 'Ungültiger Aktivitätstyp' using errcode = '22023'; end if;
      type_key := item->>'id'; type_label := btrim(item->>'label'); type_color := sammelbuch_private.checked_color(item->'color');
      if jsonb_typeof(item->'id') is distinct from 'string' or type_key !~ '^[A-Za-z0-9_-]{1,200}$' or
         jsonb_typeof(item->'label') is distinct from 'string' or char_length(type_label) not between 1 and 100 or
         jsonb_typeof(item->'color') is distinct from 'string' or type_color !~ '^#[0-9A-Fa-f]{6}$' then
        raise exception 'Ungültige Aktivität: Name, Kennung oder Farbe' using errcode = '22023';
      end if;
      if type_map ? type_key then raise exception 'Doppelte Aktivitätskennung im Backup' using errcode = '22023'; end if;
      normalized_label := lower(regexp_replace(type_label,'\s+',' ','g'));
      select t.id into matched_id from public.activity_types t
      where t.user_id = owner_id and lower(regexp_replace(btrim(t.label),'\s+',' ','g')) = normalized_label
      order by (t.id = type_key) desc,t.created_at,t.id limit 1;
      if matched_id is null then
        matched_id := type_key;
        if exists(select 1 from public.activity_types where user_id = owner_id and id = type_key) then matched_id := 'import_' || gen_random_uuid()::text; end if;
        insert into public.activity_types(user_id,id,label,color) values(owner_id,matched_id,type_label,type_color);
      end if;
      type_map := type_map || jsonb_build_object(type_key,matched_id);
    end loop;
    for item in select value from jsonb_array_elements(coalesce(data->'activities','[]'::jsonb)) loop
      if jsonb_typeof(item) is distinct from 'object' then raise exception 'Ungültiger Aktivitätseintrag' using errcode = '22023'; end if;
      day := sammelbuch_private.checked_date(item->'date'); type_key := item->>'typeId';
      if jsonb_typeof(item->'typeId') is distinct from 'string' or type_key !~ '^[A-Za-z0-9_-]{1,200}$' then
        raise exception 'Ungültige Aktivitätskennung' using errcode = '22023';
      end if;
      matched_id := coalesce(type_map->>type_key,type_key);
      -- Removed local definitions must not silently discard historical logs.
      insert into public.activity_types(user_id,id,label,color)
        values(owner_id,matched_id,'Wiederhergestellt: ' || left(type_key,82),'#6b6862') on conflict (user_id,id) do nothing;
      insert into public.activity_logs(user_id,date,type_id) values(owner_id,day,matched_id) on conflict do nothing;
    end loop;
    if data ? 'settings' and data->'settings' != 'null'::jsonb then
      patch := sammelbuch_private.checked_settings(data->'settings');
      insert into public.user_settings(user_id,goal,accent,buddy_name,onboarded)
      values(owner_id,coalesce((patch->>'goal')::numeric::smallint,40),coalesce(patch->>'accent','#6b6862'),coalesce(patch->>'buddy_name',''),coalesce((patch->>'onboarded')::boolean,false))
      on conflict (user_id) do nothing;
    end if;
  else raise exception 'Unbekannter Speicherauftrag: %', mode using errcode = '22023';
  end case;
  return public.sammelbuch_snapshot(owner_id);
end $$;

revoke all on function sammelbuch_private.checked_date(jsonb),
  sammelbuch_private.checked_integer(jsonb,integer,integer), sammelbuch_private.checked_settings(jsonb),
  sammelbuch_private.checked_color(jsonb), sammelbuch_private.checked_week(jsonb),
  public.sammelbuch_snapshot(uuid), public.sammelbuch_mutate(jsonb) from public, anon;
grant execute on function sammelbuch_private.checked_date(jsonb),
  sammelbuch_private.checked_integer(jsonb,integer,integer), sammelbuch_private.checked_settings(jsonb),
  sammelbuch_private.checked_color(jsonb), sammelbuch_private.checked_week(jsonb),
  public.sammelbuch_snapshot(uuid), public.sammelbuch_mutate(jsonb) to authenticated;
