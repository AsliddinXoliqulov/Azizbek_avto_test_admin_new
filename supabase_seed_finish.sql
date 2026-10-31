-- Kichik fayl: SQL Editor qabul qiladi.
-- 1) Avval terminalda: npm.cmd --prefix .\Frontend run seed:remote
-- 2) Keyin shu faylni RUN qiling (funksiya yo'q bo'lsa ham yaratadi va ishga tushiradi).

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

select public.refresh_legacy_questions_from_base();
