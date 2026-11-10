-- Persist admin-managed question order within each lesson.
alter table public.base_questions
  add column if not exists lesson_sort_order integer;
alter table public.admin_new_questions
  add column if not exists lesson_sort_order integer;

with ordered_questions as (
  select question_source, question_id,
         row_number() over (
           partition by lesson_id
           order by source_order, original_order nulls last, question_id
         ) - 1 as lesson_sort_order
    from (
      select 'base'::text as question_source, id as question_id, lesson_id,
             0 as source_order, sort_order as original_order
        from public.base_questions
       where lesson_id is not null and not is_deleted
      union all
      select 'admin_new'::text, id, lesson_id,
             1, id
        from public.admin_new_questions
       where lesson_id is not null and not is_deleted
    ) assigned
)
update public.base_questions question
   set lesson_sort_order = ordered.lesson_sort_order
  from ordered_questions ordered
 where ordered.question_source = 'base'
   and ordered.question_id = question.id
   and question.lesson_sort_order is null;

with ordered_questions as (
  select question_source, question_id,
         row_number() over (
           partition by lesson_id
           order by source_order, original_order nulls last, question_id
         ) - 1 as lesson_sort_order
    from (
      select 'base'::text as question_source, id as question_id, lesson_id,
             0 as source_order, sort_order as original_order
        from public.base_questions
       where lesson_id is not null and not is_deleted
      union all
      select 'admin_new'::text, id, lesson_id,
             1, id
        from public.admin_new_questions
       where lesson_id is not null and not is_deleted
    ) assigned
)
update public.admin_new_questions question
   set lesson_sort_order = ordered.lesson_sort_order
  from ordered_questions ordered
 where ordered.question_source = 'admin_new'
   and ordered.question_id = question.id
   and question.lesson_sort_order is null;

create index if not exists idx_base_questions_lesson_sort_order
  on public.base_questions(lesson_id, lesson_sort_order)
  where lesson_id is not null and not is_deleted;
create index if not exists idx_admin_new_questions_lesson_sort_order
  on public.admin_new_questions(lesson_id, lesson_sort_order)
  where lesson_id is not null and not is_deleted;

create or replace function public.admin_move_lesson_question(
  p_lesson_id bigint,
  p_question_source text,
  p_question_id bigint,
  p_direction text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ordered_keys text[];
  current_index integer;
  target_index integer;
  question_key text;
  question_source text;
  question_id bigint;
  sort_index integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_question_source is null or
     p_question_source not in ('base', 'admin_new') or
     p_direction is null or
     p_direction not in ('up', 'down') then
    raise exception 'Invalid question move' using errcode = '22023';
  end if;

  perform 1
    from public.base_lessons
   where id = p_lesson_id and not is_deleted
   for update;
  if not found then
    return false;
  end if;

  select array_agg(
           assigned.question_source || ':' || assigned.question_id::text
           order by assigned.lesson_sort_order nulls last,
                    assigned.source_order, assigned.question_id
         )
    into ordered_keys
    from (
      select 'base'::text as question_source, id as question_id,
             lesson_sort_order, 0 as source_order
        from public.base_questions
       where lesson_id = p_lesson_id and not is_deleted
      union all
      select 'admin_new', id, lesson_sort_order, 1
        from public.admin_new_questions
       where lesson_id = p_lesson_id and not is_deleted
    ) assigned;

  current_index := array_position(
    ordered_keys, p_question_source || ':' || p_question_id::text
  );
  if current_index is null then
    return false;
  end if;
  target_index := current_index + case when p_direction = 'up' then -1 else 1 end;
  if target_index < 1 or target_index > cardinality(ordered_keys) then
    return false;
  end if;

  ordered_keys[current_index] := ordered_keys[target_index];
  ordered_keys[target_index] := p_question_source || ':' || p_question_id::text;

  foreach question_key in array ordered_keys loop
    question_source := split_part(question_key, ':', 1);
    question_id := split_part(question_key, ':', 2)::bigint;
    if question_source = 'base' then
      update public.base_questions
         set lesson_sort_order = sort_index,
             updated_at = clock_timestamp()
       where id = question_id and lesson_id = p_lesson_id;
    else
      update public.admin_new_questions
         set lesson_sort_order = sort_index,
             updated_at = clock_timestamp()
       where id = question_id and lesson_id = p_lesson_id;
    end if;
    sort_index := sort_index + 1;
  end loop;
  return true;
end $$;

create or replace function public.sync_lesson_question_order(p_device_id text)
returns table (
  question_source text,
  question_id bigint,
  lesson_id bigint,
  sort_order integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_device_active(p_device_id) then
    raise exception 'DEVICE_NOT_ACTIVATED' using errcode = '42501';
  end if;
  return query
    select assigned.question_source, assigned.question_id, assigned.lesson_id,
           (row_number() over (
             partition by assigned.lesson_id
             order by assigned.lesson_sort_order nulls last,
                      assigned.source_order, assigned.question_id
           ) - 1)::integer
      from (
        select 'base'::text as question_source,
               base_question.id as question_id,
               base_question.lesson_id,
               base_question.lesson_sort_order,
               0 as source_order
          from public.base_questions as base_question
         where base_question.lesson_id is not null
           and not base_question.is_deleted
        union all
        select 'admin_new',
               admin_question.id,
               admin_question.lesson_id,
               admin_question.lesson_sort_order,
               1
          from public.admin_new_questions as admin_question
         where admin_question.lesson_id is not null
           and not admin_question.is_deleted
      ) assigned;
end $$;

revoke all on function public.admin_move_lesson_question(bigint, text, bigint, text)
  from public;
grant execute on function public.admin_move_lesson_question(bigint, text, bigint, text)
  to authenticated;
revoke all on function public.sync_lesson_question_order(text) from public;
grant execute on function public.sync_lesson_question_order(text)
  to anon, authenticated;
