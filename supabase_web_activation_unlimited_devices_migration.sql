-- Sayt kodlarini 15 kun davomida cheklanmagan qurilmalarda ishlatishga ruxsat bering.
alter table public.web_activation_tokens
  add column if not exists allowed_device_id text;

create table if not exists public.web_activation_devices (
  code_id uuid not null references public.web_activation_tokens(id) on delete cascade,
  device_id text not null,
  activated_at timestamptz not null default now(),
  primary key (code_id, device_id)
);

create index if not exists idx_web_activation_devices_device
  on public.web_activation_devices (device_id);

alter table public.web_activation_devices enable row level security;
revoke all on public.web_activation_devices from public, anon, authenticated;

-- Avvalgi migratsiyalarda saqlangan qurilma bog‘lanishlarini yo‘qotmang.
insert into public.web_activation_devices (code_id, device_id, activated_at)
select token.id, device.device_id, coalesce(token.activated_at, now())
  from public.web_activation_tokens token
  cross join lateral (
    select token.device_id as device_id
    where token.device_id is not null
    union
    select token.allowed_device_id
    where token.allowed_device_id is not null
  ) device
 where token.status in ('ACTIVATED', 'PENDING')
   and token.expires_at > now()
on conflict (code_id, device_id) do nothing;

create or replace function public.activate_web_device(p_code text, p_device_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  token_row public.web_activation_tokens;
  failed_attempts integer;
  activation_time timestamptz;
  already_activated boolean;
begin
  if coalesce(length(p_device_id), 0) < 8 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_DEVICE');
  end if;

  select count(*) into failed_attempts
    from public.activation_attempts
   where device_id = p_device_id
     and not success
     and at > now() - interval '10 minutes';
  if failed_attempts >= 10 then
    return jsonb_build_object('ok', false, 'error', 'TOO_MANY_ATTEMPTS');
  end if;

  select * into token_row
    from public.web_activation_tokens
   where code = normalized_code
   for update;

  if not found then
    insert into public.activation_attempts (device_id, success) values (p_device_id, false);
    return jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
  end if;
  if token_row.status = 'EXPIRED' or token_row.expires_at <= now() then
    delete from public.web_activation_tokens where id = token_row.id;
    return jsonb_build_object('ok', false, 'error', 'EXPIRED');
  end if;
  if token_row.status = 'REVOKED' then
    return jsonb_build_object('ok', false, 'error', 'REVOKED');
  end if;

  activation_time := now();
  select exists (
    select 1
      from public.web_activation_devices
     where code_id = token_row.id
       and device_id = p_device_id
  ) into already_activated;

  insert into public.web_activation_devices (code_id, device_id, activated_at)
  values (token_row.id, p_device_id, activation_time)
  on conflict (code_id, device_id) do nothing;

  update public.web_activation_tokens
     set status = 'ACTIVATED'::public.token_status,
         device_id = coalesce(device_id, p_device_id),
         allowed_device_id = coalesce(allowed_device_id, p_device_id),
         activated_at = coalesce(activated_at, activation_time)
   where id = token_row.id;

  if not already_activated then
    insert into public.activation_attempts (device_id, success) values (p_device_id, true);
  end if;

  return jsonb_build_object(
    'ok', true,
    'already', already_activated,
    'activated_at', coalesce(token_row.activated_at, activation_time),
    'expires_at', token_row.expires_at
  );
end;
$$;

create or replace function public.check_web_device_activation(p_device_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  latest_expiry timestamptz;
begin
  if coalesce(length(p_device_id), 0) < 8 then
    return jsonb_build_object(
      'active', false, 'server_time', clock_timestamp(), 'expires_at', null
    );
  end if;

  delete from public.web_activation_tokens
   where status = 'EXPIRED' or expires_at <= now();

  select max(token.expires_at) into latest_expiry
    from public.web_activation_devices device
    join public.web_activation_tokens token on token.id = device.code_id
   where device.device_id = p_device_id
     and token.status = 'ACTIVATED'
     and token.expires_at > now();

  return jsonb_build_object(
    'active', latest_expiry is not null,
    'server_time', clock_timestamp(),
    'expires_at', latest_expiry
  );
end;
$$;

create or replace function public.is_device_active(p_device_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.activation_tokens
     where device_id = p_device_id
       and status = 'ACTIVATED'
       and (validity_days <> 15 or expires_at > now())
  ) or exists (
    select 1
      from public.web_activation_devices device
      join public.web_activation_tokens token on token.id = device.code_id
     where device.device_id = p_device_id
       and token.status = 'ACTIVATED'
       and token.expires_at > now()
  );
$$;

create or replace function public.get_web_activation_question_state(
  p_code text,
  p_device_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  token_id uuid;
  result jsonb;
begin
  select token.id into token_id
    from public.web_activation_tokens token
    join public.web_activation_devices device on device.code_id = token.id
   where token.code = normalized_code
     and token.status = 'ACTIVATED'
     and token.expires_at > now()
     and device.device_id = p_device_id
   limit 1;

  if token_id is null then
    raise exception 'DEVICE_NOT_ACTIVATED' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'saved', coalesce((
      select jsonb_agg(jsonb_build_object(
        'question_id', question_id,
        'created_at', created_at
      ))
        from public.web_activation_question_state
       where activation_token_id = token_id
         and state_kind = 'saved'
    ), '[]'::jsonb),
    'errors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'question_id', question_id,
        'created_at', created_at
      ))
        from public.web_activation_question_state
       where activation_token_id = token_id
         and state_kind = 'error'
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

create or replace function public.set_web_activation_question_state(
  p_code text,
  p_device_id text,
  p_question_id bigint,
  p_state_kind text,
  p_enabled boolean,
  p_created_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  token_id uuid;
begin
  if p_question_id is null or p_question_id = 0 then
    raise exception 'INVALID_QUESTION_ID' using errcode = '22023';
  end if;
  if p_state_kind not in ('error', 'saved') or p_state_kind is null then
    raise exception 'INVALID_QUESTION_STATE' using errcode = '22023';
  end if;
  if p_enabled is null then
    raise exception 'INVALID_ENABLED_VALUE' using errcode = '22023';
  end if;

  select token.id into token_id
    from public.web_activation_tokens token
    join public.web_activation_devices device on device.code_id = token.id
   where token.code = normalized_code
     and token.status = 'ACTIVATED'
     and token.expires_at > now()
     and device.device_id = p_device_id
   limit 1;

  if token_id is null then
    raise exception 'DEVICE_NOT_ACTIVATED' using errcode = '42501';
  end if;

  if p_enabled then
    insert into public.web_activation_question_state (
      activation_token_id, question_id, state_kind, created_at
    )
    values (token_id, p_question_id, p_state_kind, least(coalesce(p_created_at, now()), now()))
    on conflict (activation_token_id, state_kind, question_id)
    do update set created_at = excluded.created_at;
  else
    delete from public.web_activation_question_state
     where activation_token_id = token_id
       and question_id = p_question_id
       and state_kind = p_state_kind;
  end if;
end;
$$;

revoke all on function public.activate_web_device(text, text) from public;
grant execute on function public.activate_web_device(text, text) to anon, authenticated;
revoke all on function public.check_web_device_activation(text) from public;
grant execute on function public.check_web_device_activation(text) to anon, authenticated;
revoke all on function public.is_device_active(text) from public;
grant execute on function public.is_device_active(text) to anon, authenticated;
revoke all on function public.get_web_activation_question_state(text, text) from public, anon;
grant execute on function public.get_web_activation_question_state(text, text) to anon, authenticated;
revoke all on function public.set_web_activation_question_state(text, text, bigint, text, boolean, timestamptz)
  from public, anon;
grant execute on function public.set_web_activation_question_state(text, text, bigint, text, boolean, timestamptz)
  to anon, authenticated;
