alter table public.questions
  add column if not exists image_urls jsonb not null default '[]'::jsonb,
  add column if not exists explanation_image_urls jsonb not null default '[]'::jsonb;

alter table public.admin_new_questions
  add column if not exists image_urls jsonb not null default '[]'::jsonb,
  add column if not exists explanation_image_urls jsonb not null default '[]'::jsonb;

alter table public.questions
  drop constraint if exists options_is_array,
  add constraint options_is_array
    check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) >= 2);
alter table public.questions
  alter column correct_index type integer using correct_index::integer;

alter table public.admin_new_questions
  drop constraint if exists admin_new_questions_options_check,
  add constraint admin_new_questions_options_check
    check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) >= 2);
alter table public.admin_new_questions
  alter column correct_index type integer using correct_index::integer;

with question_total as (
  select count(*) as total
    from public.questions
   where source_question_id is not null
     and is_deleted = false
     and status = 'PUBLISHED'
)
insert into public.bilets(number, title, is_deleted)
select variant.number, 'Variant ' || variant.number, false
  from question_total
  cross join lateral generate_series(1, ceil(question_total.total / 20.0)::integer) as variant(number)
on conflict (number) do update set
  title=excluded.title, is_deleted=false, updated_at=clock_timestamp();

with ranked_questions as (
  select id,
         row_number() over (order by source_question_id) as variant_order
    from public.questions
   where source_question_id is not null
     and is_deleted = false
     and status = 'PUBLISHED'
)
update public.questions q
   set bilet_id=b.id,
       bilet_position=((ranked.variant_order - 1) % 20 + 1)::integer,
       updated_at=clock_timestamp()
  from ranked_questions ranked
  join public.bilets b on b.number=((ranked.variant_order - 1) / 20 + 1)
 where q.id=ranked.id;
