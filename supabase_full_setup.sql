-- =====================================================================================
--  PDD (Haydovchilik imtihoni) TEST TIZIMI — SUPABASE TO'LIQ SOZLASH SKRIPTI (100%)
-- =====================================================================================
--  Bu BITTA fayl — boshqa hech narsa kerak emas. Supabase Dashboard > SQL Editor ga
--  to'liq nusxalab joylang va "RUN" bosing. Xavfsiz qayta ishga tushiriladi
--  (idempotent): barcha buyruqlar "if not exists" / "or replace" / "drop ... if exists"
--  bilan yozilgan, shuning uchun skriptni necha marta ishga tushirsangiz ham xato bermaydi.
--
--  TARKIB:
--    0) Kengaytmalar (extensions)
--    1) ENUM turlar
--    2) Asosiy jadvallar (admins, categories, bilets, questions)
--    3) Qo'shimcha jadvallar (reference_signs, app_settings, audit_log)
--    4) Faollashtirish jadvallari (activation_tokens, activation_attempts)
--    5) Indekslar
--    6) Yordamchi funksiyalar (is_admin, is_super_admin, ...)
--    7) Triggerlar (updated_at, created_by, admins himoyasi, audit)
--    8) Row Level Security (RLS) — barcha jadvallar uchun
--    9) Admin boshqaruv funksiyalari (admin qo'shish, ro'yxat, bloklash)
--   10) Faollashtirish kodi funksiyalari (yaratish, tekshirish, bekor qilish)
--   11) Incremental SYNC funksiyalari (Electron mijozi uchun)
--   12) Statistika / hisobot funksiyalari (admin panel uchun)
--   13) Storage (rasm fayllari uchun bucket + policy)
--   14) Boshlang'ich sozlamalar (seed) — app_settings default qiymatlari
--   15) Ixtiyoriy: pg_cron bilan avtomatik tozalash
--   16) BIRINCHI SUPER_ADMIN YARATISH (o'zgartirib, oxirida ishga tushiring)
--   17) O'ZINI-TEKSHIRISH (verification) so'rovlari
-- =====================================================================================


-- =====================================================================================
-- 0) KENGAYTMALAR
-- =====================================================================================
create extension if not exists pgcrypto;      -- gen_random_uuid(), gen_random_bytes()
create extension if not exists pg_trgm;       -- admin panelda savol matni bo'yicha qidiruv (ILIKE/trigram)


-- =====================================================================================
-- 1) ENUM TURLAR
-- =====================================================================================
do $$ begin
  create type public.admin_role as enum ('SUPER_ADMIN', 'SUB_ADMIN');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.category_kind as enum ('TOPIC', 'ROAD_SIGN', 'CHEATSHEET');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.token_status as enum ('PENDING', 'ACTIVATED', 'EXPIRED', 'REVOKED');
exception when duplicate_object then null; end $$;


-- =====================================================================================
-- 2) ASOSIY JADVALLAR
-- =====================================================================================
create table if not exists public.admins (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  full_name   text,
  role        public.admin_role not null default 'SUB_ADMIN',
  is_active   boolean not null default true,
  created_by  uuid references public.admins(id),
  created_at  timestamptz not null default now()
);
comment on table public.admins is 'Admin panelga kira oladigan foydalanuvchilar (auth.users bilan 1-1 bog''langan).';

create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        public.category_kind not null default 'TOPIC',
  sort_order  int  not null default 0,
  is_deleted  boolean not null default false,
  created_by  uuid references public.admins(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default clock_timestamp()
);
comment on table public.categories is 'Mavzular / Yo''l belgilari guruhlari / Shpargalka bo''limlari.';

create table if not exists public.bilets (
  id          uuid primary key default gen_random_uuid(),
  number      int  not null unique check (number > 0),
  title       text,
  is_deleted  boolean not null default false,
  created_by  uuid references public.admins(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default clock_timestamp()
);
comment on table public.bilets is 'Imtihon biletlari (odatda har birida 20 tadan savol).';

create table if not exists public.questions (
  id                    uuid primary key default gen_random_uuid(),
  bilet_id              uuid references public.bilets(id) on delete set null,
  bilet_position        int,                               -- bilet ichidagi tartib (1..20)
  category_id           uuid references public.categories(id) on delete set null,
  text                  text not null,
  options               jsonb not null,                    -- ["A javob","B javob",...]
  correct_index         integer not null check (correct_index >= 0),
  image_url             text,                              -- savol rasmi (yo'l belgisi, vaziyat)
  explanation           text,                               -- shpargalka / tushuntirish matni
  explanation_image_url text,                               -- vizual shpargalka
  sign_code             text,                               -- yo'l belgisi rasmiy kodi (masalan "1.1")
  is_tricky             boolean not null default false,     -- chalg'ituvchi
  is_road_sign          boolean not null default false,
  is_numeric            boolean not null default false,     -- raqamli savol
  source_note           text,                                -- qaysi PDF/manbadan import qilingani
  status                text not null default 'PUBLISHED'
                        check (status in ('DRAFT','PUBLISHED')),  -- import qilingan, lekin hali tasdiqlanmagan savollar
  is_deleted            boolean not null default false,      -- soft delete (sync uchun shart)
  created_by            uuid references public.admins(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default clock_timestamp(),
  constraint options_is_array check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) >= 2),
  constraint correct_in_range check (correct_index < jsonb_array_length(options))
);
comment on table public.questions is 'Test savollari. status=DRAFT bo''lsa foydalanuvchiga sync qilinmaydi.';
alter table public.questions
  add column if not exists image_urls jsonb not null default '[]'::jsonb,
  add column if not exists explanation_image_urls jsonb not null default '[]'::jsonb;


-- =====================================================================================
-- 3) QO'SHIMCHA JADVALLAR
-- =====================================================================================

-- Rasmiy yo'l belgilari ro'yxati — import to'liqligini tekshirish va internetdan
-- to'ldirish uchun (ARCHITECTURE.md dagi import algoritmi shu jadvalga tayanadi).
create table if not exists public.reference_signs (
  code        text primary key,           -- "1.1", "3.24" va h.k.
  name        text not null,
  group_name  text,                        -- "Ogohlantiruvchi", "Taqiqlovchi" ...
  image_url   text,                        -- topilgan rasmning saqlangan nusxasi
  source_url  text,                        -- qayerdan olingani
  license     text,                        -- litsenziya/manba izohi
  status      text not null default 'MISSING'
              check (status in ('MISSING','FOUND','VERIFIED')),
  updated_at  timestamptz not null default clock_timestamp()
);
comment on table public.reference_signs is 'Rasmiy yo''l belgilari ma''lumotnomasi — qamrovni tekshirish uchun.';

-- Ilova sozlamalari — UI'dagi vaqt/son qoidalarini kodga qotirmasdan boshqarish.
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default clock_timestamp()
);
comment on table public.app_settings is 'Masalan: seconds_per_question, exam_question_count, exam_seconds.';

-- Audit jurnali — kim nimani o'zgartirgani (adminlar va kodlar uchun muhim).
create table if not exists public.audit_log (
  id          bigserial primary key,
  actor_id    uuid references public.admins(id),
  action      text not null,
  entity      text not null,
  entity_id   text,
  details     jsonb,
  at          timestamptz not null default now()
);
comment on table public.audit_log is 'Admin amallari tarixi (kuzatuv/javobgarlik uchun).';


-- =====================================================================================
-- 4) FAOLLASHTIRISH JADVALLARI
-- =====================================================================================
create table if not exists public.activation_tokens (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  note          text,                                      -- kimga berilgani (ism/telefon)
  status        public.token_status not null default 'PENDING',
  created_by    uuid references public.admins(id),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '1 hour'),
  device_id     text,
  activated_at  timestamptz
);
comment on table public.activation_tokens is 'Desktop ilovani faollashtirish kodlari. 1 soat amal qiladi, bitta qurilma uchun bir marta.';

create table if not exists public.activation_attempts (   -- brute-force himoyasi
  id         bigserial primary key,
  device_id  text not null,
  success    boolean not null,
  at         timestamptz not null default now()
);


-- =====================================================================================
-- 5) INDEKSLAR
-- =====================================================================================
create index if not exists idx_questions_sync      on public.questions (updated_at, id);
create index if not exists idx_bilets_sync         on public.bilets (updated_at, id);
create index if not exists idx_categories_sync     on public.categories (updated_at, id);
create index if not exists idx_questions_bilet     on public.questions (bilet_id, bilet_position);
create index if not exists idx_questions_category  on public.questions (category_id);
create index if not exists idx_questions_tricky    on public.questions (id) where is_tricky;
create index if not exists idx_questions_numeric   on public.questions (id) where is_numeric;
create index if not exists idx_questions_signs     on public.questions (id) where is_road_sign;
create index if not exists idx_questions_status    on public.questions (status);
create index if not exists idx_questions_text_trgm on public.questions using gin (text gin_trgm_ops);
create index if not exists idx_tokens_status       on public.activation_tokens (status, expires_at);
create index if not exists idx_tokens_device       on public.activation_tokens (device_id) where status = 'ACTIVATED';
create index if not exists idx_attempts_device     on public.activation_attempts (device_id, at);
create index if not exists idx_audit_at            on public.audit_log (at desc);


-- =====================================================================================
-- 6) YORDAMCHI FUNKSIYALAR
-- =====================================================================================
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where id = auth.uid() and is_active);
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins
                 where id = auth.uid() and is_active and role = 'SUPER_ADMIN');
$$;

create or replace function public.current_admin_role()
returns public.admin_role language sql stable security definer set search_path = public as $$
  select role from public.admins where id = auth.uid() and is_active;
$$;

grant execute on function public.is_admin(), public.is_super_admin(), public.current_admin_role()
  to authenticated;


-- =====================================================================================
-- 7) TRIGGERLAR
-- =====================================================================================

-- updated_at ni avtomatik yangilash (haqiqiy vaqt — clock_timestamp())
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists trg_questions_touch   on public.questions;
create trigger trg_questions_touch   before update on public.questions
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_bilets_touch      on public.bilets;
create trigger trg_bilets_touch      before update on public.bilets
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_categories_touch  on public.categories;
create trigger trg_categories_touch  before update on public.categories
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_refsigns_touch    on public.reference_signs;
create trigger trg_refsigns_touch    before update on public.reference_signs
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_settings_touch    on public.app_settings;
create trigger trg_settings_touch    before update on public.app_settings
  for each row execute function public.touch_updated_at();

-- created_by ni avtomatik to'ldirish
create or replace function public.set_created_by()
returns trigger language plpgsql as $$
begin
  if new.created_by is null then new.created_by := auth.uid(); end if;
  return new;
end $$;

drop trigger if exists trg_questions_cb  on public.questions;
create trigger trg_questions_cb  before insert on public.questions  for each row execute function public.set_created_by();
drop trigger if exists trg_bilets_cb     on public.bilets;
create trigger trg_bilets_cb     before insert on public.bilets     for each row execute function public.set_created_by();
drop trigger if exists trg_categories_cb on public.categories;
create trigger trg_categories_cb before insert on public.categories for each row execute function public.set_created_by();

-- Iyerarxiya himoyasi: faqat SUPER_ADMIN adminlarni o'zgartiradi;
-- tizimda kamida 1 ta faol SUPER_ADMIN qolishi shart.
create or replace function public.admins_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_super_admin() then
    raise exception 'FORBIDDEN: faqat SUPER_ADMIN adminlarni boshqara oladi' using errcode = '42501';
  end if;

  if old.role = 'SUPER_ADMIN' and old.is_active
     and (tg_op = 'DELETE' or new.role <> 'SUPER_ADMIN' or not new.is_active) then
    if not exists (select 1 from public.admins
                   where id <> old.id and role = 'SUPER_ADMIN' and is_active) then
      raise exception 'LAST_SUPER_ADMIN: oxirgi SUPER_ADMIN ni o''chirib/pasaytirib bo''lmaydi';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists trg_admins_guard on public.admins;
create trigger trg_admins_guard before update or delete on public.admins
  for each row execute function public.admins_guard();

-- Audit: adminlar va faollashtirish kodlaridagi muhim o'zgarishlarni yozib boradi
create or replace function public.audit_admins()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (auth.uid(), tg_op, 'admins', coalesce(new.id, old.id)::text,
          jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new)));
  return coalesce(new, old);
end $$;

drop trigger if exists trg_admins_audit on public.admins;
create trigger trg_admins_audit after insert or update or delete on public.admins
  for each row execute function public.audit_admins();


-- =====================================================================================
-- 8) ROW LEVEL SECURITY (RLS)
-- =====================================================================================
alter table public.admins              enable row level security;
alter table public.categories          enable row level security;
alter table public.bilets              enable row level security;
alter table public.questions           enable row level security;
alter table public.reference_signs     enable row level security;
alter table public.app_settings        enable row level security;
alter table public.audit_log           enable row level security;
alter table public.activation_tokens   enable row level security;
alter table public.activation_attempts enable row level security;  -- policy yo'q = hech kim to'g'ridan-to'g'ri o'qiy olmaydi

-- --- admins -----------------------------------------------------------------------
drop policy if exists admins_select on public.admins;
create policy admins_select on public.admins for select
  using (id = auth.uid() or public.is_super_admin());
drop policy if exists admins_insert on public.admins;
create policy admins_insert on public.admins for insert
  with check (public.is_super_admin());
drop policy if exists admins_update on public.admins;
create policy admins_update on public.admins for update
  using (public.is_super_admin()) with check (public.is_super_admin());
drop policy if exists admins_delete on public.admins;
create policy admins_delete on public.admins for delete
  using (public.is_super_admin());
grant select on public.admins to authenticated;

-- --- kontent jadvallari (categories, bilets, questions, reference_signs) -----------
-- Har qanday faol admin o'qiydi/yozadi/yangilaydi (soft delete); qat'iy DELETE faqat SUPER_ADMIN.
do $$
declare t text;
begin
  foreach t in array array['categories','bilets','questions','reference_signs'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select using (public.is_admin())', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('create policy %1$s_insert on public.%1$s for insert with check (public.is_admin())', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('create policy %1$s_update on public.%1$s for update using (public.is_admin()) with check (public.is_admin())', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format('create policy %1$s_delete on public.%1$s for delete using (public.is_super_admin())', t);
  end loop;
end $$;

-- --- app_settings: hamma admin ko'radi, faqat SUPER_ADMIN o'zgartiradi ------------
drop policy if exists settings_select on public.app_settings;
create policy settings_select on public.app_settings for select using (public.is_admin());
drop policy if exists settings_upsert on public.app_settings;
create policy settings_upsert on public.app_settings for insert with check (public.is_super_admin());
drop policy if exists settings_update on public.app_settings;
create policy settings_update on public.app_settings for update
  using (public.is_super_admin()) with check (public.is_super_admin());
drop policy if exists settings_delete on public.app_settings;
create policy settings_delete on public.app_settings for delete using (public.is_super_admin());

-- --- audit_log: faqat SUPER_ADMIN ko'radi, hech kim to'g'ridan-to'g'ri yozmaydi ---
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select using (public.is_super_admin());

-- --- activation_tokens: SUB_ADMIN faqat o'zinikini, SUPER_ADMIN hammasini --------
-- INSERT/UPDATE to'g'ridan-to'g'ri emas — pastdagi funksiyalar orqali amalga oshadi.
drop policy if exists tokens_select on public.activation_tokens;
create policy tokens_select on public.activation_tokens for select
  using (public.is_super_admin() or (public.is_admin() and created_by = auth.uid()));

-- Electron (anon) ilovasi jadvallarga TO'G'RIDAN-TO'G'RI TEGA OLMAYDI —
-- faqat pastda beriladigan SECURITY DEFINER funksiyalar orqali ishlaydi.
revoke all on public.questions, public.bilets, public.categories, public.reference_signs,
              public.app_settings, public.audit_log,
              public.activation_tokens, public.activation_attempts, public.admins from anon;

-- MCP / service_role kaliti jadvallarni o'qishi uchun (RLS service_role uchun o'tkazib yuboriladi,
-- lekin GRANT bo'lmasa PostgREST 403 qaytaradi).
grant select, insert, update, delete on
  public.admins, public.categories, public.bilets, public.questions, public.reference_signs,
  public.app_settings, public.audit_log, public.activation_tokens, public.activation_attempts
  to service_role;


-- =====================================================================================
-- 9) ADMIN BOSHQARUV FUNKSIYALARI
-- =====================================================================================

-- Auth'da allaqachon yaratilgan foydalanuvchini admin qiladi (email orqali bog'laydi).
create or replace function public.create_admin_profile(
  p_email text, p_full_name text, p_role public.admin_role default 'SUB_ADMIN')
returns public.admins language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.admins;
begin
  if not public.is_super_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email));
  if v_uid is null then
    raise exception 'AUTH_USER_NOT_FOUND: avval Authentication bo''limida foydalanuvchi yarating';
  end if;
  insert into public.admins (id, email, full_name, role, created_by)
  values (v_uid, lower(trim(p_email)), p_full_name, p_role, auth.uid())
  on conflict (id) do update
    set full_name = excluded.full_name, role = excluded.role, is_active = true
  returning * into v_row;
  return v_row;
end $$;

-- Adminni faol/nofaol qilish (bloklash/blokdan chiqarish)
create or replace function public.set_admin_active(p_admin_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update public.admins set is_active = p_active where id = p_admin_id;
end $$;

-- Adminlar ro'yxati + har birining nechta kod yaratgani (admin panel uchun qulay)
create or replace function public.list_admins()
returns table (id uuid, email text, full_name text, role public.admin_role,
               is_active boolean, created_at timestamptz, tokens_created bigint)
language sql stable security definer set search_path = public as $$
  select a.id, a.email, a.full_name, a.role, a.is_active, a.created_at,
         count(t.id) as tokens_created
    from public.admins a
    left join public.activation_tokens t on t.created_by = a.id
   where public.is_super_admin()
   group by a.id
   order by a.created_at;
$$;

grant execute on function
  public.create_admin_profile(text,text,public.admin_role),
  public.set_admin_active(uuid,boolean),
  public.list_admins()
  to authenticated;


-- =====================================================================================
-- 10) FAOLLASHTIRISH KODI FUNKSIYALARI
-- =====================================================================================

-- Admin yangi kod yaratadi (8 belgi, chalkash harflarsiz: 0/O, 1/I yo'q). 1 soat amal qiladi.
create or replace function public.generate_activation_code(p_note text default null)
returns public.activation_tokens language plpgsql security definer set search_path = extensions, public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text; v_row public.activation_tokens; i int; b bytea;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  loop
    b := gen_random_bytes(8); v_code := '';
    for i in 0..7 loop
      v_code := v_code || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.activation_tokens where code = v_code);
  end loop;
  insert into public.activation_tokens (code, note, created_by)
  values (v_code, p_note, auth.uid()) returning * into v_row;

  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'CREATE_CODE', 'activation_tokens', v_row.id::text, jsonb_build_object('note', p_note));
  return v_row;
end $$;

-- 1 soat o'tgan, ishlatilmagan kodlarni EXPIRED qiladi (admin panel yoki cron chaqiradi)
create or replace function public.expire_stale_tokens()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.activation_tokens set status = 'EXPIRED'
   where status = 'PENDING' and expires_at < now();
  get diagnostics n = row_count;
  return n;
end $$;

-- Admin kodni bekor qiladi (ishlatilgan bo'lsa ham, qurilma keyingi tekshiruvda qulflanadi)
create or replace function public.revoke_activation_code(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update public.activation_tokens set status = 'REVOKED'
   where id = p_id and (public.is_super_admin() or created_by = auth.uid());

  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(), 'REVOKE_CODE', 'activation_tokens', p_id::text);
end $$;

-- MIJOZ (anon, Electron) chaqiradi. Kod 1 soat ichida kiritilishi shart;
-- bir marta, bitta qurilmaga. 10 daqiqada 10 ta xato urinishdan keyin bloklanadi.
create or replace function public.activate_device(p_code text, p_device_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_code text := upper(regexp_replace(coalesce(p_code,''), '[^A-Za-z0-9]', '', 'g'));
        v_tok public.activation_tokens; v_fails int;
begin
  if coalesce(length(p_device_id),0) < 8 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_DEVICE');
  end if;

  select count(*) into v_fails from public.activation_attempts
   where device_id = p_device_id and not success and at > now() - interval '10 minutes';
  if v_fails >= 10 then
    return jsonb_build_object('ok', false, 'error', 'TOO_MANY_ATTEMPTS');
  end if;

  select * into v_tok from public.activation_tokens where code = v_code for update;

  if not found then
    insert into public.activation_attempts (device_id, success) values (p_device_id, false);
    return jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
  end if;

  if v_tok.status = 'REVOKED' then
    return jsonb_build_object('ok', false, 'error', 'REVOKED');
  end if;

  if v_tok.status = 'ACTIVATED' then
    if v_tok.device_id = p_device_id then
      return jsonb_build_object('ok', true, 'already', true, 'activated_at', v_tok.activated_at);
    end if;
    insert into public.activation_attempts (device_id, success) values (p_device_id, false);
    return jsonb_build_object('ok', false, 'error', 'ALREADY_USED');
  end if;

  if v_tok.status = 'EXPIRED' or v_tok.expires_at < now() then
    update public.activation_tokens set status = 'EXPIRED' where id = v_tok.id;
    return jsonb_build_object('ok', false, 'error', 'EXPIRED');
  end if;

  update public.activation_tokens
     set status = 'ACTIVATED', device_id = p_device_id, activated_at = now()
   where id = v_tok.id;
  insert into public.activation_attempts (device_id, success) values (p_device_id, true);
  return jsonb_build_object('ok', true, 'already', false, 'activated_at', now());
end $$;

-- Qurilma hozir ham faolmi? (revoke aniqlash va sync himoyasi uchun)
create or replace function public.is_device_active(p_device_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.activation_tokens
                 where device_id = p_device_id and status = 'ACTIVATED');
$$;


-- =====================================================================================
-- 11) INCREMENTAL SYNC FUNKSIYALARI (faqat o'zgargan qatorlar)
-- =====================================================================================
-- Kursor: (updated_at, id). status != PUBLISHED yoki is_deleted bo'lgan savollar
-- mijozga DRAFT/soft-delete sifatida qaytadi (ilova ularni lokal o'chiradi).

create or replace function public.sync_questions(
  p_device_id text,
  p_since     timestamptz default 'epoch',
  p_after_id  uuid        default '00000000-0000-0000-0000-000000000000',
  p_limit     int         default 500)
returns setof public.questions language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_device_active(p_device_id) then
    raise exception 'DEVICE_NOT_ACTIVATED' using errcode = '42501';
  end if;
  return query
    select q.* from public.questions q
     where (q.updated_at, q.id) > (p_since, p_after_id)
       and (q.status = 'PUBLISHED' or q.is_deleted)   -- DRAFT holatdagilar sync qilinmaydi
     order by q.updated_at, q.id
     limit least(greatest(p_limit,1), 1000);
end $$;

-- Kategoriya, biletlar va sozlamalar (kichik hajmli) — bitta chaqiruvda
create or replace function public.sync_catalog(p_device_id text, p_since timestamptz default 'epoch')
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_device_active(p_device_id) then
    raise exception 'DEVICE_NOT_ACTIVATED' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'categories', coalesce((select jsonb_agg(to_jsonb(c) order by c.updated_at) from public.categories c where c.updated_at > p_since), '[]'::jsonb),
    'bilets',     coalesce((select jsonb_agg(to_jsonb(b) order by b.updated_at) from public.bilets b     where b.updated_at > p_since), '[]'::jsonb),
    'settings',   coalesce((select jsonb_object_agg(s.key, s.value) from public.app_settings s), '{}'::jsonb),
    'server_time', clock_timestamp());
end $$;

-- Funksiya ruxsatlari: anon (Electron) + authenticated (admin panel ham foydalansa bo'ladi)
revoke all on function public.activate_device(text,text), public.is_device_active(text),
  public.sync_questions(text,timestamptz,uuid,int), public.sync_catalog(text,timestamptz) from public;
grant execute on function public.activate_device(text,text), public.is_device_active(text),
  public.sync_questions(text,timestamptz,uuid,int), public.sync_catalog(text,timestamptz) to anon, authenticated;

revoke all on function
  public.generate_activation_code(text), public.revoke_activation_code(uuid), public.expire_stale_tokens()
  from public, anon;
grant execute on function
  public.generate_activation_code(text), public.revoke_activation_code(uuid), public.expire_stale_tokens()
  to authenticated;


-- =====================================================================================
-- 12) STATISTIKA / HISOBOT FUNKSIYALARI (admin panel uchun)
-- =====================================================================================

-- Qamrov hisoboti: nechta savol, nechtasi DRAFT, nechta bilet, nechta yetishmagan belgi
create or replace function public.coverage_report()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'questions_total',      (select count(*) from public.questions where not is_deleted),
    'questions_published',  (select count(*) from public.questions where status='PUBLISHED' and not is_deleted),
    'questions_draft',       (select count(*) from public.questions where status='DRAFT' and not is_deleted),
    'bilets_total',          (select count(*) from public.bilets where not is_deleted),
    'tricky_count',          (select count(*) from public.questions where is_tricky and not is_deleted),
    'numeric_count',         (select count(*) from public.questions where is_numeric and not is_deleted),
    'road_sign_count',       (select count(*) from public.questions where is_road_sign and not is_deleted),
    'reference_signs_total', (select count(*) from public.reference_signs),
    'reference_signs_missing', (select count(*) from public.reference_signs where status='MISSING'),
    'active_codes',          (select count(*) from public.activation_tokens where status='ACTIVATED'),
    'pending_codes',         (select count(*) from public.activation_tokens where status='PENDING' and expires_at > now())
  );
$$;
grant execute on function public.coverage_report() to authenticated;


-- =====================================================================================
-- 13) STORAGE (rasm fayllari: yo'l belgilari, shpargalka)
-- =====================================================================================
insert into storage.buckets (id, name, public)
values ('pdd-images', 'pdd-images', true)
on conflict (id) do nothing;

drop policy if exists "pdd images read"   on storage.objects;
create policy "pdd images read"   on storage.objects for select using (bucket_id = 'pdd-images');
drop policy if exists "pdd images write"  on storage.objects;
create policy "pdd images write"  on storage.objects for insert with check (bucket_id = 'pdd-images' and public.is_admin());
drop policy if exists "pdd images update" on storage.objects;
create policy "pdd images update" on storage.objects for update using (bucket_id = 'pdd-images' and public.is_admin());
drop policy if exists "pdd images delete" on storage.objects;
create policy "pdd images delete" on storage.objects for delete using (bucket_id = 'pdd-images' and public.is_super_admin());


-- =====================================================================================
-- 14) BOSHLANG'ICH SOZLAMALAR (seed) — app_settings
-- =====================================================================================
insert into public.app_settings (key, value, description) values
  ('seconds_per_question', '1.25', 'Savol sonini tanlab ishlashda 1 ta savolga necha soniya beriladi'),
  ('exam_question_count',  '20',   'Haqiqiy imtihondagi savollar soni'),
  ('exam_seconds',         '1500', 'Haqiqiy imtihon vaqti (soniyada) — 25 daqiqa'),
  ('activation_code_ttl_minutes', '60', 'Faollashtirish kodi amal qilish muddati (daqiqa)'),
  ('activation_max_fail_attempts', '10', 'Qurilma bloklanishidan oldingi xato urinishlar soni'),
  ('activation_fail_window_minutes', '10', 'Xato urinishlar hisoblanadigan vaqt oynasi (daqiqa)')
on conflict (key) do nothing;


-- =====================================================================================
-- 15) IXTIYORIY: pg_cron BILAN AVTOMATIK TOZALASH
-- =====================================================================================
-- Supabase loyihangizda "pg_cron" kengaytmasi yoqilgan bo'lsa (Database > Extensions),
-- quyidagi bloqni izohdan chiqarib (-- larni olib tashlab) qayta ishga tushiring:
--
-- create extension if not exists pg_cron;
-- select cron.schedule(
--   'expire-activation-tokens',
--   '*/5 * * * *',                               -- har 5 daqiqada
--   $$select public.expire_stale_tokens()$$
-- );
--
-- Agar pg_cron mavjud bo'lmasa, admin panelda "Yangilash" tugmasi bosilganda
-- `select expire_stale_tokens();` chaqirib turish kifoya.


-- =====================================================================================
-- 16) BIRINCHI SUPER_ADMIN YARATISH  —  O'ZGARTIRIB, SO'NGRA ALOHIDA ISHGA TUSHIRING
-- =====================================================================================
-- Avval: Supabase Dashboard > Authentication > Users > "Add user"
--        orqali o'zingizning email/parolingiz bilan foydalanuvchi yarating.
-- Keyin pastdagi qatorni o'z emailingiz bilan almashtirib, ALOHIDA ishga tushiring
-- (bu yerda izohlangan — avtomatik ishlamaydi, chunki email har kim uchun boshqacha):
--
-- insert into public.admins (id, email, full_name, role)
-- select id, email, 'Bosh admin', 'SUPER_ADMIN'
--   from auth.users where lower(email) = lower('siz@example.com')
-- on conflict (id) do update set role = 'SUPER_ADMIN', is_active = true;
--
-- Muhim: Authentication > Providers > Email bo'limida
-- "Allow new users to sign up" ni O'CHIRING — begona odam ro'yxatdan o'ta olmasin.


-- =====================================================================================
-- 17) O'ZINI-TEKSHIRISH (ixtiyoriy, qo'lda ishga tushiring)
-- =====================================================================================
-- select * from public.app_settings order by key;
-- select schemaname, tablename, rowsecurity from pg_tables
--   where schemaname='public' order by tablename;              -- rowsecurity = true bo'lishi kerak
-- select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--   where n.nspname='public' order by proname;                 -- barcha funksiyalar ro'yxati
-- select public.coverage_report();                              -- bazaning umumiy holati
-- =====================================================================================
--  TUGADI. Skript boshqa hech qanday qo'shimcha sozlamani talab qilmaydi.
-- =====================================================================================


-- =====================================================================================
-- 18) BASE/question_bank.json — KANONIK MA'LUMOTLAR BAZASI
-- =====================================================================================
-- Frontend importer uchun CSV formati emas, Base/question_bank.json dagi asl iyerarxiya
-- ishlatiladi: bo'lim -> dars -> savol -> javob va savol rasmlari. Barcha tarjimalar
-- jsonb ko'rinishida saqlanadi. Javobi yetishmagan savollar va orphan javoblar yo'qolmaydi.

create table if not exists public.base_sections (
  id          bigint primary key,
  sort_order  integer not null,
  name        jsonb not null check (jsonb_typeof(name) = 'object'),
  created_at  timestamptz not null,
  updated_at  timestamptz not null default clock_timestamp()
);

create table if not exists public.base_lessons (
  id          bigint primary key,
  section_id  bigint not null references public.base_sections(id) on delete cascade,
  sort_order  integer not null,
  title       jsonb not null check (jsonb_typeof(title) = 'object'),
  created_at  timestamptz not null,
  updated_at  timestamptz not null default clock_timestamp()
);

create table if not exists public.base_questions (
  id            bigint primary key,
  question_type text not null,
  lesson_id     bigint not null references public.base_lessons(id) on delete cascade,
  sort_order    integer,
  text          jsonb not null check (jsonb_typeof(text) = 'object'),
  created_at    timestamptz not null,
  updated_at    timestamptz not null default clock_timestamp(),
  is_deleted    boolean not null default false
);

create table if not exists public.base_answers (
  id          bigint generated by default as identity primary key,
  question_id bigint not null references public.base_questions(id) on delete cascade,
  sort_order  integer not null,
  text        jsonb not null check (jsonb_typeof(text) = 'object'),
  is_correct  boolean not null,
  created_at  timestamptz,
  updated_at  timestamptz,
  unique (question_id, sort_order)
);

create table if not exists public.base_question_images (
  id           text primary key,
  question_id  bigint not null references public.base_questions(id) on delete cascade,
  role         text not null check (role in ('question', 'description')),
  path         text,
  source_path  text,
  storage_path text,
  status       text not null check (status in ('available', 'missing')),
  link_basis   text
);

create table if not exists public.base_orphan_answers (
  id            bigint primary key,
  question_type text not null,
  question_id   bigint not null,
  text          jsonb not null check (jsonb_typeof(text) = 'object'),
  is_correct    boolean not null,
  created_at    timestamptz,
  updated_at    timestamptz
);

create table if not exists public.base_exam_variants (
  id          bigint generated by default as identity primary key,
  source_id   text unique,
  variant     jsonb not null
);

create table if not exists public.admin_new_questions (
  id                    bigint generated by default as identity (start with 1000000000) primary key,
  lesson_id             bigint references public.base_lessons(id) on delete set null,
  text                  text not null check (length(btrim(text)) > 0),
  options               jsonb not null check (
                          jsonb_typeof(options) = 'array'
                          and jsonb_array_length(options) >= 2
                        ),
  correct_index         integer not null check (correct_index >= 0),
  image_url             text,
  explanation           text,
  explanation_image_url text,
  is_deleted            boolean not null default false,
  created_by            uuid references public.admins(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default clock_timestamp(),
  image_urls            jsonb not null default '[]'::jsonb,
  explanation_image_urls jsonb not null default '[]'::jsonb,
  constraint admin_new_correct_in_range check (correct_index < jsonb_array_length(options))
);
alter table public.admin_new_questions
  add column if not exists lesson_id bigint references public.base_lessons(id) on delete set null;
alter table public.admin_new_questions
  add column if not exists image_urls jsonb not null default '[]'::jsonb,
  add column if not exists explanation_image_urls jsonb not null default '[]'::jsonb;
comment on table public.admin_new_questions is
  'Admin savollari; lesson_id NULL bo‘lsa yangi savol, lesson_id berilsa tegishli dars savoli.';

create table if not exists public.base_import_metadata (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default clock_timestamp()
);

-- UUID asosidagi mavjud admin sahifalari uchun barqaror, tekshiriladigan proyeksiya.
alter table public.categories add column if not exists source_lesson_id bigint;
alter table public.questions add column if not exists source_question_id bigint;
alter table public.questions add column if not exists source_question_type text;
create unique index if not exists idx_categories_source_lesson
  on public.categories(source_lesson_id) where source_lesson_id is not null;
create unique index if not exists idx_questions_source_question
  on public.questions(source_question_id) where source_question_id is not null;

create index if not exists idx_base_lessons_section_order
  on public.base_lessons(section_id, sort_order);
create index if not exists idx_base_questions_sync
  on public.base_questions(updated_at, id);
create index if not exists idx_admin_new_questions_sync
  on public.admin_new_questions(updated_at, id);
create index if not exists idx_base_questions_lesson_order
  on public.base_questions(lesson_id, sort_order);
create index if not exists idx_base_answers_question_order
  on public.base_answers(question_id, sort_order, id);
create index if not exists idx_base_images_question_role
  on public.base_question_images(question_id, role);
create index if not exists idx_base_orphan_question
  on public.base_orphan_answers(question_id);

alter table public.base_sections enable row level security;
alter table public.base_lessons enable row level security;
alter table public.base_questions enable row level security;
alter table public.base_answers enable row level security;
alter table public.base_question_images enable row level security;
alter table public.base_orphan_answers enable row level security;
alter table public.base_exam_variants enable row level security;
alter table public.admin_new_questions enable row level security;
alter table public.base_import_metadata enable row level security;

grant select, insert, update, delete on
  public.base_sections, public.base_lessons, public.base_questions, public.base_answers,
  public.base_question_images, public.base_orphan_answers, public.base_exam_variants,
  public.admin_new_questions, public.base_import_metadata to authenticated, service_role;
grant usage, select on sequence public.base_answers_id_seq to authenticated, service_role;
grant usage, select on sequence public.base_exam_variants_id_seq to authenticated, service_role;
grant usage, select on sequence public.admin_new_questions_id_seq to authenticated, service_role;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'base_sections', 'base_lessons', 'base_questions', 'base_answers',
    'base_question_images', 'base_orphan_answers', 'base_exam_variants',
    'admin_new_questions', 'base_import_metadata'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_admin_select', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_admin())',
      table_name || '_admin_select', table_name
    );
    execute format('drop policy if exists %I on public.%I', table_name || '_admin_insert', table_name);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_admin())',
      table_name || '_admin_insert', table_name
    );
    execute format('drop policy if exists %I on public.%I', table_name || '_admin_update', table_name);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())',
      table_name || '_admin_update', table_name
    );
    execute format('drop policy if exists %I on public.%I', table_name || '_admin_delete', table_name);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.is_admin())',
      table_name || '_admin_delete', table_name
    );
  end loop;
end $$;

-- Javob yoki rasm o'zgarganda savolning sync vaqti ham yangilanadi.
create or replace function public.touch_base_parent_question()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.question_id <> new.question_id) then
    update public.base_questions set updated_at = clock_timestamp() where id = old.question_id;
  end if;
  if tg_op <> 'DELETE' then
    update public.base_questions set updated_at = clock_timestamp() where id = new.question_id;
  end if;
  return null;
end $$;

drop trigger if exists trg_base_answers_touch_parent on public.base_answers;
create trigger trg_base_answers_touch_parent
  after insert or update or delete on public.base_answers
  for each row execute function public.touch_base_parent_question();
drop trigger if exists trg_base_images_touch_parent on public.base_question_images;
create trigger trg_base_images_touch_parent
  after insert or update or delete on public.base_question_images
  for each row execute function public.touch_base_parent_question();

-- Backfill Storage paths for rows seeded before the upload path was stored.
update public.base_question_images
   set storage_path = 'base-import/' ||
     replace(coalesce(path, source_path), chr(92), '/')
 where status = 'available'
   and coalesce(path, source_path) is not null
   and replace(coalesce(path, source_path), chr(92), '/') like 'images/%'
   and storage_path is distinct from
     'base-import/' ||
       replace(coalesce(path, source_path), chr(92), '/');

drop trigger if exists trg_base_sections_touch on public.base_sections;
create trigger trg_base_sections_touch before update on public.base_sections
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_base_lessons_touch on public.base_lessons;
create trigger trg_base_lessons_touch before update on public.base_lessons
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_base_questions_touch on public.base_questions;
create trigger trg_base_questions_touch before update on public.base_questions
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_base_import_metadata_touch on public.base_import_metadata;
create trigger trg_base_import_metadata_touch before update on public.base_import_metadata
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_admin_new_questions_touch on public.admin_new_questions;
create trigger trg_admin_new_questions_touch before update on public.admin_new_questions
  for each row execute function public.touch_updated_at();

-- Storage public URL dan bucket ichidagi yo'lni ajratadi.
create or replace function public.pdd_storage_path_from_url(p_url text)
returns text language sql immutable as $$
  select case
    when p_url is null or length(btrim(p_url)) = 0 then null
    when position('/object/public/pdd-images/' in p_url) > 0 then
      substring(p_url from '/object/public/pdd-images/(.+)$')
    when p_url like 'base-import/%' or p_url like 'questions/%' then p_url
    else null
  end
$$;

-- Mavjud admin savol tahrirlash oynasi Base savollarini o'zgartirganda
-- shu o'zgarishlar ham kanonik jadval va desktop sync'ga uzatiladi.
create or replace function public.sync_legacy_question_to_base()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lesson_id bigint;
  v_index integer;
  v_answer public.base_answers;
  v_option text;
begin
  if new.source_question_id is null then return new; end if;

  select source_lesson_id into v_lesson_id
    from public.categories where id = new.category_id;

  update public.base_questions
     set text = jsonb_set(coalesce(text, '{}'::jsonb), '{uz-Latn}', to_jsonb(new.text), true),
         lesson_id = coalesce(v_lesson_id, lesson_id),
         updated_at = clock_timestamp(),
         is_deleted = new.is_deleted or new.status <> 'PUBLISHED'
   where id = new.source_question_id;

  delete from public.base_answers
   where question_id = new.source_question_id
     and sort_order >= jsonb_array_length(new.options);

  for v_index in 0..jsonb_array_length(new.options) - 1 loop
    v_option := new.options->>v_index;
    select * into v_answer from public.base_answers
     where question_id = new.source_question_id and sort_order = v_index;
    if found then
      update public.base_answers
         set text = jsonb_set(coalesce(text, '{}'::jsonb), '{uz-Latn}', to_jsonb(v_option), true),
             is_correct = (v_index = new.correct_index),
             updated_at = clock_timestamp()
       where id = v_answer.id;
    else
      insert into public.base_answers(question_id, sort_order, text, is_correct)
      values (
        new.source_question_id, v_index,
        jsonb_build_object('uz-Latn', v_option, 'uz-Cyrl', v_option, 'ru', v_option),
        v_index = new.correct_index
      );
    end if;
  end loop;

  -- Admin panel rasmlari ham kanonik Base jadvaliga yozilsin, desktop sync ko'rsin.
  if new.image_url is not null and length(btrim(new.image_url)) > 0 then
    insert into public.base_question_images
      (id, question_id, role, path, source_path, storage_path, status, link_basis)
    values (
      'legacy-' || new.source_question_id::text || '-question',
      new.source_question_id, 'question', null, null,
      public.pdd_storage_path_from_url(new.image_url), 'available', 'legacy_questions'
    )
    on conflict (id) do update set
      storage_path=excluded.storage_path, status='available', link_basis=excluded.link_basis;
  end if;
  if new.explanation_image_url is not null and length(btrim(new.explanation_image_url)) > 0 then
    insert into public.base_question_images
      (id, question_id, role, path, source_path, storage_path, status, link_basis)
    values (
      'legacy-' || new.source_question_id::text || '-description',
      new.source_question_id, 'description', null, null,
      public.pdd_storage_path_from_url(new.explanation_image_url), 'available', 'legacy_questions'
    )
    on conflict (id) do update set
      storage_path=excluded.storage_path, status='available', link_basis=excluded.link_basis;
  end if;
  return new;
end $$;

drop trigger if exists trg_legacy_question_to_base on public.questions;
create trigger trg_legacy_question_to_base
  after insert or update on public.questions
  for each row execute function public.sync_legacy_question_to_base();

-- Admin panel UUID jadvallarini Base jadvallaridan yangilaydi (kichik, SQL Editor'da ishlaydi).
create or replace function public.refresh_legacy_questions_from_base()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  answer_sequence regclass;
  max_answer_id bigint;
  published_count bigint;
begin
  alter table public.questions disable trigger trg_legacy_question_to_base;

  with valid_questions as (
    select q.id
      from public.base_questions q
      join public.base_answers a on a.question_id=q.id
     where q.question_type <> 'admin_new' and q.is_deleted = false
     group by q.id
    having count(a.id) >= 2 and count(a.id) filter (where a.is_correct) = 1
  ),
  question_total as (
    select count(*) as total from valid_questions
  )
  insert into public.bilets(number, title, is_deleted)
  select variant.number, 'Variant ' || variant.number, false
    from question_total
    cross join lateral generate_series(1, ceil(question_total.total / 20.0)::integer) as variant(number)
  on conflict (number) do update set
    title=excluded.title, is_deleted=false, updated_at=clock_timestamp();

  insert into public.categories(id, name, kind, sort_order, is_deleted, updated_at, source_lesson_id)
  select md5('pdd-base-lesson:' || lesson.id::text)::uuid,
         lesson.title->>'uz-Latn', 'TOPIC'::public.category_kind,
         lesson.sort_order, false, clock_timestamp(), lesson.id
    from public.base_lessons lesson
  on conflict (id) do update set
    name=excluded.name, kind=excluded.kind, sort_order=excluded.sort_order,
    is_deleted=false, updated_at=clock_timestamp(), source_lesson_id=excluded.source_lesson_id;

  with prepared_questions as (
    select q.id, q.question_type, q.lesson_id, q.sort_order, q.text,
           q.created_at, q.updated_at,
           jsonb_agg(to_jsonb(a.text->>'uz-Latn') order by a.sort_order, a.id) as options,
           min(a.sort_order) filter (where a.is_correct) as correct_index,
           count(a.id) as answer_count,
           count(a.id) filter (where a.is_correct) as correct_count
      from public.base_questions q
      join public.base_answers a on a.question_id=q.id
     where q.is_deleted = false
     group by q.id
  ),
  ranked_questions as (
    select q.*,
           row_number() over (order by q.id) as variant_order
      from prepared_questions q
     where q.question_type <> 'admin_new'
       and q.answer_count >= 2 and q.correct_count=1
  )
  insert into public.questions(
    id, bilet_id, bilet_position, category_id, text, options, correct_index,
    image_url, explanation, explanation_image_url, sign_code, is_tricky, is_road_sign,
    is_numeric, source_note, status, is_deleted, created_at, updated_at,
    source_question_id, source_question_type
  )
  select md5('pdd-base-question:' || q.id::text)::uuid,
         b.id, ((q.variant_order - 1) % 20 + 1)::integer,
         md5('pdd-base-lesson:' || q.lesson_id::text)::uuid,
         q.text->>'uz-Latn', q.options, q.correct_index,
         (
           select 'https://nnrvmihtgutyminrfdna.supabase.co/storage/v1/object/public/pdd-images/' || i.storage_path
             from public.base_question_images i
            where i.question_id = q.id and i.role = 'question'
              and i.status = 'available' and i.storage_path is not null
            order by i.id limit 1
         ),
         null,
         (
           select 'https://nnrvmihtgutyminrfdna.supabase.co/storage/v1/object/public/pdd-images/' || i.storage_path
             from public.base_question_images i
            where i.question_id = q.id and i.role = 'description'
              and i.status = 'available' and i.storage_path is not null
            order by i.id limit 1
         ),
         null, false, false, false,
         'Base/question_bank.json ID ' || q.id, 'PUBLISHED', false,
         q.created_at, q.updated_at, q.id, q.question_type
    from ranked_questions q
    join public.bilets b on b.number = ((q.variant_order - 1) / 20 + 1)
  on conflict (id) do update set
    bilet_id=excluded.bilet_id, bilet_position=excluded.bilet_position,
    category_id=excluded.category_id, text=excluded.text, options=excluded.options,
    correct_index=excluded.correct_index,
    image_url=excluded.image_url,
    explanation_image_url=excluded.explanation_image_url,
    source_note=excluded.source_note,
    status='PUBLISHED', is_deleted=false, updated_at=clock_timestamp(),
    source_question_id=excluded.source_question_id,
    source_question_type=excluded.source_question_type;

  alter table public.questions enable trigger trg_legacy_question_to_base;

  answer_sequence := pg_get_serial_sequence('public.base_answers', 'id')::regclass;
  select max(id) into max_answer_id from public.base_answers;
  if answer_sequence is not null and max_answer_id is not null then
    perform setval(answer_sequence, max_answer_id, true);
  end if;

  select count(*) into published_count
    from public.questions
   where is_deleted = false and status = 'PUBLISHED' and source_question_id is not null;

  return jsonb_build_object('published_questions', published_count);
end $$;

grant execute on function public.refresh_legacy_questions_from_base() to authenticated, service_role;

-- Ushbu funksiya faqat SQL Editor'dan keladigan seed fayli uchun; public API orqali chaqirilmaydi.
create or replace function public.seed_base_question_bank(p_payload jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  answer_sequence regclass;
  max_answer_id bigint;
begin
  if jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(p_payload->'sections') <> 'array'
     or jsonb_typeof(p_payload->'lessons') <> 'array'
     or jsonb_typeof(p_payload->'questions') <> 'array'
     or jsonb_typeof(p_payload->'orphan_answers') <> 'array'
     or jsonb_typeof(p_payload->'exam_variants') <> 'array' then
    raise exception 'BASE_IMPORT_INVALID: question_bank.json sxemasi noto''g''ri';
  end if;

  insert into public.base_sections(id, sort_order, name, created_at, updated_at)
  select (item->>'id')::bigint, (item->>'order')::integer, item->'name',
         (item->>'created_at')::timestamptz, (item->>'created_at')::timestamptz
    from jsonb_array_elements(p_payload->'sections') item
  on conflict (id) do update set
    sort_order=excluded.sort_order, name=excluded.name, created_at=excluded.created_at,
    updated_at=clock_timestamp();

  insert into public.base_lessons(id, section_id, sort_order, title, created_at, updated_at)
  select (item->>'id')::bigint, (item->>'section_id')::bigint, (item->>'order')::integer,
         item->'title', (item->>'created_at')::timestamptz, (item->>'created_at')::timestamptz
    from jsonb_array_elements(p_payload->'lessons') item
  on conflict (id) do update set
    section_id=excluded.section_id, sort_order=excluded.sort_order, title=excluded.title,
    created_at=excluded.created_at, updated_at=clock_timestamp();

  insert into public.base_questions
    (id, question_type, lesson_id, sort_order, text, created_at, updated_at, is_deleted)
  select (item->>'id')::bigint, item->>'type', (item->>'lesson_id')::bigint,
         nullif(item->>'order', 'null')::integer, item->'text',
         (item->>'created_at')::timestamptz, (item->>'updated_at')::timestamptz, false
    from jsonb_array_elements(p_payload->'questions') item
  on conflict (id) do update set
    question_type=excluded.question_type, lesson_id=excluded.lesson_id,
    sort_order=excluded.sort_order, text=excluded.text, created_at=excluded.created_at,
    updated_at=clock_timestamp(), is_deleted=false;

  delete from public.base_answers;
  delete from public.base_question_images;

  insert into public.base_answers
    (id, question_id, sort_order, text, is_correct, created_at, updated_at)
  select (answer.item->>'id')::bigint, (question_item->>'id')::bigint,
         answer.ordinality::integer - 1, answer.item->'text',
         (answer.item->>'is_correct')::boolean,
         nullif(answer.item->>'created_at', 'null')::timestamptz,
         nullif(answer.item->>'updated_at', 'null')::timestamptz
    from jsonb_array_elements(p_payload->'questions') question_item
    cross join lateral jsonb_array_elements(coalesce(question_item->'answers', '[]'::jsonb))
      with ordinality answer(item, ordinality)
  on conflict (id) do update set
    question_id=excluded.question_id, sort_order=excluded.sort_order, text=excluded.text,
    is_correct=excluded.is_correct, created_at=excluded.created_at,
    updated_at=excluded.updated_at;

  insert into public.base_question_images(id, question_id, role, path, source_path, storage_path, status, link_basis)
  select image.item->>'id', (question_item->>'id')::bigint, image.item->>'role',
         nullif(image.item->>'path', 'null'), nullif(image.item->>'source_path', 'null'),
         case when image.item->>'status' = 'available' and image.item->>'path' <> 'null'
              then 'base-import/' || (image.item->>'path')
              else null end,
         image.item->>'status', image.item->>'link_basis'
    from jsonb_array_elements(p_payload->'questions') question_item
    cross join lateral jsonb_array_elements(coalesce(question_item->'images', '[]'::jsonb)) image(item)
  on conflict (id) do update set
    question_id=excluded.question_id, role=excluded.role, path=excluded.path,
    source_path=excluded.source_path, storage_path=excluded.storage_path,
    status=excluded.status, link_basis=excluded.link_basis;

  insert into public.base_orphan_answers
    (id, question_type, question_id, text, is_correct, created_at, updated_at)
  select (item->>'id')::bigint, item->>'type', (item->>'question_id')::bigint,
         item->'text', (item->>'is_correct')::boolean,
         nullif(item->>'created_at', 'null')::timestamptz,
         nullif(item->>'updated_at', 'null')::timestamptz
    from jsonb_array_elements(p_payload->'orphan_answers') item
  on conflict (id) do update set
    question_type=excluded.question_type, question_id=excluded.question_id,
    text=excluded.text, is_correct=excluded.is_correct,
    created_at=excluded.created_at, updated_at=excluded.updated_at;

  delete from public.base_orphan_answers o
   where not exists (
     select 1 from jsonb_array_elements(p_payload->'orphan_answers') item
      where (item->>'id')::bigint = o.id
   );

  delete from public.base_exam_variants;
  insert into public.base_exam_variants(source_id, variant)
  select item->>'id', item
    from jsonb_array_elements(p_payload->'exam_variants') item;

  answer_sequence := pg_get_serial_sequence('public.base_answers', 'id')::regclass;
  select max(id) into max_answer_id from public.base_answers;
  if answer_sequence is not null and max_answer_id is not null then
    perform setval(answer_sequence, max_answer_id, true);
  end if;

  insert into public.base_import_metadata(key, value)
  select key, value from jsonb_each(jsonb_build_object(
    'schema_version', p_payload->'schema_version',
    'source', p_payload->'source',
    'data_quality', p_payload->'data_quality'
  ))
  on conflict (key) do update set value=excluded.value, updated_at=clock_timestamp();

  perform public.refresh_legacy_questions_from_base();
end $$;

revoke all on function public.seed_base_question_bank(jsonb) from public, anon, authenticated;
grant execute on function public.seed_base_question_bank(jsonb) to postgres, service_role;

create or replace function public.sync_base_catalog(p_device_id text, p_since timestamptz default 'epoch')
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_device_active(p_device_id) then
    raise exception 'DEVICE_NOT_ACTIVATED' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'sort_order', sort_order, 'name', name, 'created_at', created_at,
        'updated_at', updated_at
      ) order by sort_order, id) from public.base_sections
    ), '[]'::jsonb),
    'lessons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'section_id', section_id, 'sort_order', sort_order, 'title', title,
        'created_at', created_at, 'updated_at', updated_at
      ) order by section_id, sort_order, id) from public.base_lessons
    ), '[]'::jsonb),
    'settings', coalesce((
      select jsonb_object_agg(key, value) from public.app_settings
    ), '{}'::jsonb),
    'server_time', clock_timestamp()
  );
end $$;

drop function if exists public.sync_base_questions(text,timestamptz,bigint,integer);
create function public.sync_base_questions(
  p_device_id text,
  p_since timestamptz default 'epoch',
  p_after_id bigint default 0,
  p_limit integer default 500
)
returns table (
  id bigint,
  question_type text,
  lesson_id bigint,
  sort_order integer,
  text jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  explanation jsonb,
  answers jsonb,
  images jsonb,
  is_deleted boolean
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_device_active(p_device_id) then
    raise exception 'DEVICE_NOT_ACTIVATED' using errcode = '42501';
  end if;
  return query
    with question_rows as (
      select q.id as id,
             q.question_type as question_type,
             q.lesson_id as lesson_id,
             q.sort_order as sort_order,
             q.text as text,
             q.created_at as created_at,
             q.updated_at as updated_at,
             null::jsonb as explanation,
             coalesce((
             select jsonb_agg(jsonb_build_object(
               'id', a.id, 'sort_order', a.sort_order, 'text', a.text,
               'is_correct', a.is_correct, 'created_at', a.created_at, 'updated_at', a.updated_at
             ) order by a.sort_order, a.id)
               from public.base_answers a where a.question_id=q.id
           ), '[]'::jsonb) as answers,
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'id', i.id, 'role', i.role, 'path', i.path, 'source_path', i.source_path,
               'storage_path', i.storage_path, 'status', i.status, 'link_basis', i.link_basis
             ) order by i.role, i.id)
               from public.base_question_images i where i.question_id=q.id
           ), '[]'::jsonb) as images,
           q.is_deleted as is_deleted
        from public.base_questions q
      union all
      select q.id as id,
           case when q.lesson_id is null then 'admin_new'::text else 'admin_added'::text end as question_type,
           coalesce(q.lesson_id, -1)::bigint as lesson_id,
           case when q.lesson_id is null then
             row_number() over (order by q.id)::integer
           else
             coalesce((
               select max(base_question.sort_order)
                 from public.base_questions base_question
                where base_question.lesson_id=q.lesson_id
             ), -1) + row_number() over (partition by q.lesson_id order by q.id)::integer
           end as sort_order,
           jsonb_build_object(
             'uz-Latn', q.text, 'uz-Cyrl', q.text, 'ru', q.text
           ) as text,
           q.created_at as created_at,
           q.updated_at as updated_at,
           case when q.explanation is null then null else
             jsonb_build_object(
               'uz-Latn', q.explanation, 'uz-Cyrl', q.explanation, 'ru', q.explanation
             )
           end as explanation,
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'id', q.id * 10 + option.ordinality,
               'sort_order', option.ordinality - 1,
               'text', jsonb_build_object(
                 'uz-Latn', option.value #>> '{}',
                 'uz-Cyrl', option.value #>> '{}',
                 'ru', option.value #>> '{}'
               ),
               'is_correct', option.ordinality - 1 = q.correct_index,
               'created_at', q.created_at, 'updated_at', q.updated_at
             ) order by option.ordinality)
               from jsonb_array_elements(q.options) with ordinality as option(value, ordinality)
           ), '[]'::jsonb) as answers,
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'id', 'admin-new-' || q.id::text || '-' || image.role,
               'role', image.role,
               'path', null,
               'source_path', null,
               'storage_path', null,
               'storage_url', image.url,
               'status', 'available',
               'link_basis', 'admin_new_questions'
             ))
             from (values
               ('question'::text, q.image_url),
               ('description'::text, q.explanation_image_url)
             ) as image(role, url)
             where image.url is not null and length(btrim(image.url)) > 0
           ), '[]'::jsonb) as images,
           q.is_deleted as is_deleted
        from public.admin_new_questions q
    )
    select question_rows.id, question_rows.question_type, question_rows.lesson_id,
           question_rows.sort_order, question_rows.text, question_rows.created_at,
           question_rows.updated_at, question_rows.explanation, question_rows.answers,
           question_rows.images, question_rows.is_deleted
      from question_rows
     where (question_rows.updated_at, question_rows.id) > (p_since, p_after_id)
     order by question_rows.updated_at, question_rows.id
     limit least(greatest(p_limit, 1), 1000);
end $$;

revoke all on function public.sync_base_catalog(text,timestamptz),
  public.sync_base_questions(text,timestamptz,bigint,integer) from public;
grant execute on function public.sync_base_catalog(text,timestamptz),
  public.sync_base_questions(text,timestamptz,bigint,integer) to anon, authenticated;






-- insert into public.admins (id, email, full_name, role)
-- select id, email, 'Bosh admin', 'SUPER_ADMIN'
-- from auth.users where lower(email) = lower('siz@example.com')
-- on conflict (id) do update set role = 'SUPER_ADMIN', is_active = true;
