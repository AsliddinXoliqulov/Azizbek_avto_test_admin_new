-- Tezkor tuzatish: MCP/service_role 403 va admin panel rasmlari.
-- Supabase Dashboard → SQL Editor da shu faylni RUN qiling, keyin
-- supabase_full_setup.sql ni qayta ishga tushiring va question_bank_seed.sql ni yuklang.

grant usage on schema public to service_role;

grant select, insert, update, delete on
  public.admins, public.categories, public.bilets, public.questions, public.reference_signs,
  public.app_settings, public.audit_log, public.activation_tokens, public.activation_attempts,
  public.base_sections, public.base_lessons, public.base_questions, public.base_answers,
  public.base_question_images, public.base_orphan_answers, public.base_exam_variants,
  public.admin_new_questions, public.base_import_metadata
  to service_role;

grant usage, select on all sequences in schema public to service_role;

update public.base_question_images
   set storage_path = 'base-import/' ||
     replace(coalesce(path, source_path), chr(92), '/')
 where status = 'available'
   and coalesce(path, source_path) is not null
   and replace(coalesce(path, source_path), chr(92), '/') like 'images/%'
   and storage_path is distinct from
     'base-import/' ||
       replace(coalesce(path, source_path), chr(92), '/');

update public.questions q
   set image_url = (
         select 'https://nnrvmihtgutyminrfdna.supabase.co/storage/v1/object/public/pdd-images/' || i.storage_path
           from public.base_question_images i
          where i.question_id = q.source_question_id
            and i.role = 'question' and i.status = 'available' and i.storage_path is not null
          order by i.id limit 1
       ),
       explanation_image_url = (
         select 'https://nnrvmihtgutyminrfdna.supabase.co/storage/v1/object/public/pdd-images/' || i.storage_path
           from public.base_question_images i
          where i.question_id = q.source_question_id
            and i.role = 'description' and i.status = 'available' and i.storage_path is not null
          order by i.id limit 1
       ),
       updated_at = clock_timestamp()
 where q.source_question_id is not null;
