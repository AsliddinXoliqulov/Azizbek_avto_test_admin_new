-- Supabase'da pgcrypto funksiyalari odatda extensions sxemasida bo'ladi.
-- Mavjud activation code generatoriga shu sxemani qidiruv yo'liga qo'shing.
alter function public.generate_activation_code(text)
  set search_path = extensions, public;
