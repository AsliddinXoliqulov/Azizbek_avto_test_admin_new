-- Admin o'z profilidagi ism va emailni xavfsiz yangilashi uchun bir marta ishga tushiring.
-- Supabase Dashboard > SQL Editor ichida, admin foydalanuvchisi bilan login qilgandan so'ng kerak emas;
-- bu skriptni loyiha egasi/service role SQL Editor'da bir marta ishga tushiradi.

create or replace function public.admins_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_super_admin() then
    if tg_op = 'UPDATE'
       and old.id = auth.uid()
       and new.id = old.id
       and new.role = old.role
       and new.is_active = old.is_active
       and new.created_by is not distinct from old.created_by
       and new.created_at = old.created_at then
      return new;
    end if;
    raise exception 'FORBIDDEN: admin faqat o‘z profilidagi ism va emailni yangilashi mumkin'
      using errcode = '42501';
  end if;

  if old.role = 'SUPER_ADMIN' and old.is_active
     and (tg_op = 'DELETE' or new.role <> 'SUPER_ADMIN' or not new.is_active) then
    if not exists (
      select 1 from public.admins
      where id <> old.id and role = 'SUPER_ADMIN' and is_active
    ) then
      raise exception 'LAST_SUPER_ADMIN: oxirgi SUPER_ADMIN ni o''chirib/pasaytirib bo''lmaydi';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.update_own_admin_profile(
  p_full_name text default null,
  p_sync_email boolean default false
)
returns public.admins
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.admins;
  v_auth_email text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'FORBIDDEN: faol admin sessiyasi talab qilinadi'
      using errcode = '42501';
  end if;

  select lower(email)
    into v_auth_email
    from auth.users
   where id = auth.uid();

  if v_auth_email is null then
    raise exception 'AUTH_EMAIL_NOT_FOUND: foydalanuvchining tasdiqlangan emaili topilmadi';
  end if;

  update public.admins
     set full_name = case
                       when p_sync_email then full_name
                       else nullif(trim(coalesce(p_full_name, '')), '')
                     end,
         email = case when p_sync_email then v_auth_email else email end
   where id = auth.uid()
     and is_active
   returning * into v_admin;

  if not found then
    raise exception 'ADMIN_PROFILE_NOT_FOUND: faol admin profili topilmadi'
      using errcode = '42501';
  end if;
  return v_admin;
end;
$$;

revoke all on function public.update_own_admin_profile(text, boolean) from public, anon;
grant execute on function public.update_own_admin_profile(text, boolean) to authenticated;
