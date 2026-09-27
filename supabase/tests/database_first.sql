-- Run against a migrated test database as postgres with ON_ERROR_STOP=1.
-- Synthetic users and all changes are rolled back; no real account is read or edited.
begin;
insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002');

create function pg_temp.mutate(value jsonb) returns jsonb language sql security invoker as $$
  select public.sammelbuch_mutate(value || jsonb_build_object('expectedUserId',auth.uid()));
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);

do $$
declare s jsonb; before_import jsonb; failed boolean;
begin
  s := public.sammelbuch_snapshot();
  if s->'settings' != 'null'::jsonb or jsonb_array_length(s->'checkins') != 0 then raise exception 'Empty snapshot defaults failed'; end if;
  if has_function_privilege('anon','public.sammelbuch_snapshot(uuid)','execute') or
     has_function_privilege('anon','public.sammelbuch_mutate(jsonb)','execute') then raise exception 'Anon RPC grants leaked'; end if;
  if has_table_privilege('anon','public.activity_logs','select') or has_table_privilege('anon','public.check_ins','select') then raise exception 'Anon table grants leaked'; end if;

  perform pg_temp.mutate('{"kind":"checkin","date":"2025-12-31","on":true,"level":"leicht"}');
  perform pg_temp.mutate('{"kind":"checkin","date":"2026-01-01","on":true,"level":"stark"}');
  perform pg_temp.mutate('{"kind":"checkin","date":"2026-01-01","on":true}');
  s := public.sammelbuch_snapshot();
  if jsonb_array_length(s->'checkins') != 2 or s->'checkins'->1->>'level' != 'stark' then raise exception 'All years or idempotent checkin failed'; end if;
  perform pg_temp.mutate('{"kind":"route","date":"2026-01-01","color":"g","value":2}');
  s := pg_temp.mutate('{"kind":"route","date":"2026-01-01","color":"p","value":3}');
  if s->'routes'->0->>'g' != '2' or s->'routes'->0->>'p' != '3' then raise exception 'Route patch clobbered another color'; end if;
  perform pg_temp.mutate('{"kind":"settings","patch":{"goal":90,"buddy_name":"Test Buddy","accent":"#AbC","onboarded":true}}');
  s := pg_temp.mutate('{"kind":"settings","patch":{"goal":100}}');
  if s->'settings'->>'buddy_name' != 'Test Buddy' or s->'settings'->>'accent' != '#aabbcc' or s->'settings'->>'goal' != '100' then raise exception 'Settings patch failed'; end if;

  perform pg_temp.mutate('{"kind":"type_upsert","id":"run","label":"Joggen","color":"#F80"}');
  perform pg_temp.mutate('{"kind":"type_upsert","id":"collision","label":"Liegestütze","color":"#123456"}');
  s := pg_temp.mutate('{"kind":"activity","date":"2026-02-10","typeId":"run","on":true}');
  if s->'activities'->0->>'date' != '2026-02-10' then raise exception 'Activity without bouldering failed'; end if;
  s := pg_temp.mutate('{"kind":"import","data":{
    "checkins":[{"date":"2026-01-01","level":"leicht"},{"date":"2024-01-01","level":"normal"}],
    "routes":[{"date":"2026-01-01","g":1},{"date":"2024-02-03","bl":2}],
    "buddyWeeks":["2020-W53","2026-W01"],
    "settings":{"goal":10,"buddy_name":"Should not win","onboarded":false},
    "activityTypes":[{"id":"local_run","label":"  JOGGEN  ","color":"#000000"},{"id":"collision","label":"Klimmzüge","color":"#000000"}],
    "activities":[{"date":"2024-02-03","typeId":"local_run"},{"date":"2024-02-03","typeId":"collision"},{"date":"2024-02-04","typeId":"deleted_local_type"}]
  }}');
  if s->'settings'->>'goal' != '100' then raise exception 'Import overwrote cloud settings'; end if;
  if (select level from public.check_ins where date='2026-01-01') != 'stark' then raise exception 'Import overwrote cloud level'; end if;
  if (select g from public.routes where date='2026-01-01') != 2 then raise exception 'Import overwrote cloud routes'; end if;
  if not exists(select 1 from public.routes where date='2024-02-03' and bl=2) or exists(select 1 from public.check_ins where date='2024-02-03') then raise exception 'Orphan route preservation failed'; end if;
  if not exists(select 1 from public.activity_logs where date='2024-02-03' and type_id='run') then raise exception 'Normalized label remapping failed'; end if;
  if (select count(*) from public.activity_types where label='Joggen') != 1 then raise exception 'Duplicate type imported'; end if;
  if not exists(select 1 from public.activity_logs a join public.activity_types t on t.user_id=a.user_id and t.id=a.type_id where a.date='2024-02-03' and t.label='Klimmzüge' and t.id!='collision') then raise exception 'ID collision remapping failed'; end if;
  if not exists(select 1 from public.activity_logs a join public.activity_types t on t.user_id=a.user_id and t.id=a.type_id where a.date='2024-02-04' and t.label like 'Wiederhergestellt:%') then raise exception 'Orphan activity recovery failed'; end if;

  before_import := public.sammelbuch_snapshot(); failed := false;
  begin
    perform pg_temp.mutate('{"kind":"import","data":{"checkins":[{"date":"2030-01-01"},{"date":"2030-02-30"}]}}');
  exception when others then failed := true; end;
  if not failed or before_import != public.sammelbuch_snapshot() then raise exception 'Invalid import did not roll back'; end if;
  failed := false;
  begin perform pg_temp.mutate('{"kind":"import","data":{"activities":{}}}'); exception when invalid_parameter_value then failed := true; end;
  if not failed then raise exception 'Malformed JSON accepted'; end if;
  failed := false;
  begin perform pg_temp.mutate('{"kind":"route","date":"2026-01-01","color":"g","value":4}'); exception when invalid_parameter_value then failed := true; end;
  if not failed then raise exception 'Invalid route bounds accepted'; end if;
  failed := false;
  begin perform pg_temp.mutate('{"kind":"buddy","week":"2021-W53","on":true}'); exception when invalid_parameter_value then failed := true; end;
  if not failed then raise exception 'Impossible ISO week accepted'; end if;
  failed := false;
  begin perform public.sammelbuch_mutate('{"kind":"checkin","date":"2026-03-01","on":true,"expectedUserId":"00000000-0000-4000-8000-000000000002"}'); exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'Cross-account race guard failed'; end if;
  failed := false;
  begin perform public.sammelbuch_mutate('{"kind":"checkin","date":"2026-03-01","on":true}'); exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'Missing account race guard accepted'; end if;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
do $$
declare s jsonb; failed boolean := false;
begin
  s := public.sammelbuch_snapshot();
  if jsonb_array_length(s->'checkins') != 0 or jsonb_array_length(s->'activityTypes') != 0 or s->'settings' != 'null'::jsonb then raise exception 'Snapshot leaked other user'; end if;
  if exists(select 1 from public.check_ins) or exists(select 1 from public.activity_logs) or exists(select 1 from public.user_settings) then raise exception 'RLS SELECT leaked other user'; end if;
  begin
    insert into public.activity_types(user_id,id,label,color) values('00000000-0000-4000-8000-000000000001','attack','Attack','#000000');
  exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'RLS allowed writing another user'; end if;
  failed := false;
  begin perform pg_temp.mutate('{"kind":"activity","date":"2026-02-01","typeId":"run","on":true}'); exception when foreign_key_violation then failed := true; end;
  if not failed then raise exception 'Composite owner foreign key failed'; end if;
  perform pg_temp.mutate('{"kind":"type_upsert","id":"run","label":"User 2 Joggen","color":"#123456"}');
  perform pg_temp.mutate('{"kind":"activity","date":"2026-02-01","typeId":"run","on":true}');
  s := pg_temp.mutate('{"kind":"import","data":{"settings":{"goal":45,"onboarded":true},"checkins":[{"date":"2026-01-01","level":"leicht"}]}}');
  if s->'settings'->>'goal' != '45' or jsonb_array_length(s->'checkins') != 1 then raise exception 'Fresh settings import failed'; end if;
  update public.activity_types set label='Wrong account' where user_id='00000000-0000-4000-8000-000000000001';
  if found then raise exception 'RLS update touched another user'; end if;
  delete from public.activity_logs where user_id='00000000-0000-4000-8000-000000000001';
  if found then raise exception 'RLS delete touched another user'; end if;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$
declare s jsonb; failed boolean := false;
begin
  perform pg_temp.mutate('{"kind":"checkin","date":"2026-01-01","on":false}');
  if exists(select 1 from public.routes where date='2026-01-01') then raise exception 'Checkin removal left routes'; end if;
  begin perform pg_temp.mutate('{"kind":"level","date":"2026-01-01","level":"leicht"}'); exception when invalid_parameter_value then failed := true; end;
  if not failed then raise exception 'Level without checkin accepted'; end if;
  failed := false;
  begin perform pg_temp.mutate('{"kind":"route","date":"2026-01-01","color":"g","value":2}'); exception when invalid_parameter_value then failed := true; end;
  if not failed then raise exception 'Route without checkin accepted'; end if;
  perform pg_temp.mutate('{"kind":"type_delete","id":"run"}');
  if exists(select 1 from public.activity_logs where type_id='run') then raise exception 'Type delete did not cascade'; end if;
  s := pg_temp.mutate('{"kind":"reset_year","year":2024}');
  if exists(select 1 from public.check_ins where year=2024) or exists(select 1 from public.routes where year=2024) or exists(select 1 from public.activity_logs where extract(year from date)=2024) then raise exception 'Year reset incomplete'; end if;
  if not exists(select 1 from public.check_ins where year=2025) or not exists(select 1 from public.activity_types where id='collision') or s->'settings'->>'goal' != '100' then raise exception 'Year reset damaged other years/settings/types'; end if;
  perform pg_temp.mutate('{"kind":"checkin","date":"9999-12-31","on":true}');
  perform pg_temp.mutate('{"kind":"reset_year","year":9999}');
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
do $$
begin
  if not exists(select 1 from public.activity_logs where type_id='run') or not exists(select 1 from public.check_ins where date='2026-01-01') then raise exception 'Other user damaged by delete/reset'; end if;
end $$;

select set_config('request.jwt.claim.sub','',true);
do $$
declare failed boolean := false;
begin
  begin perform public.sammelbuch_snapshot(); exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'Snapshot allowed missing identity'; end if;
end $$;
reset role;
select 'Database-first SQL assertions passed: CRUD, merge, rollback, two-user RLS, auth race, bounds and deletion.' as result;
rollback;
