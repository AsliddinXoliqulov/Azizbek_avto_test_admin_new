# PDD admin panel

React + Vite + TypeScript admin web panel. The Electron desktop app is built
from the repository root; this folder contains the independent content/admin
panel and the Supabase setup scripts.

The admin panel is installable as a PWA over HTTPS in browsers that support PWA
installation. Use the install button in the top bar or login screen; the browser
must show and confirm its own install prompt. If no prompt is available, use
the browser's **Install app** / **Add to Home screen** action. On iPhone and
iPad, open the site in Safari and use **Share → Add to Home Screen**.

## New Supabase project

1. Create a Supabase project.
2. For an existing project, first run [`supabase_live_fix.sql`](./supabase_live_fix.sql)
   (unlocks `service_role` / MCP and backfills image URLs). Then re-run
   [`supabase_full_setup.sql`](./supabase_full_setup.sql) in Dashboard →
   SQL Editor.
3. Seed the question bank from the terminal (SQL Editor rejects the huge seed file):

   ```powershell
   npm.cmd --prefix .\Frontend run seed:remote
   ```

   Then run [`supabase_seed_finish.sql`](./supabase_seed_finish.sql) in SQL Editor.
4. In Authentication → Users, create the initial admin user. Update and run the
   commented first `SUPER_ADMIN` SQL statement in section 16 of the setup file.
5. Disable public email sign-up in Authentication → Providers → Email.
6. Copy `.env.example` to `.env` and set the Supabase project URL and public
   anon key. Never put a `service_role` key in this frontend.
7. Upload the source images with the **Base yuklash** panel, or run:

   ```powershell
   npm.cmd --prefix .\Frontend run import:base
   ```

   The importer checks that the SQL seed has been installed, authenticates the
   admin without writing the password to disk, and uploads `Base/images` to
   `pdd-images/base-import/`. It is safe to rerun.

For email profile updates, optionally run
[`supabase_auth_profile_setup.sql`](./supabase_auth_profile_setup.sql). If
activation-code generation reports that `gen_random_bytes(integer)` is
missing, run [`supabase_activation_code_fix.sql`](./supabase_activation_code_fix.sql).
For an existing database, run
[`supabase_activation_code_admin_actions.sql`](./supabase_activation_code_admin_actions.sql)
in Dashboard → SQL Editor before using the activation-code restore and permanent
delete actions. New setups also include these functions in
[`supabase_full_setup.sql`](./supabase_full_setup.sql).

For browser-site activation codes, run
[`supabase_web_activation_migration.sql`](./supabase_web_activation_migration.sql)
in Dashboard → SQL Editor before deploying the updated panel and website (run it
again to apply the 15-day expiry update and allow web activations to use the
shared content-sync RPCs on an existing installation). The
migration stores website codes separately from desktop codes; website codes and
activated access expire 15 days after code creation. Create them from the
**Sayt** tab in the activation-code panel. Expired website codes are deleted
when the website checks activation or the admin refreshes its code list;
expired desktop codes are deleted when the admin refreshes that list.

Sayt kodlarini qayta ishlatiladigan 6 xonali raqamli formatga o'tkazish uchun
[`supabase_web_activation_reusable_codes_migration.sql`](./supabase_web_activation_reusable_codes_migration.sql)
faylini yuqoridagi web aktivatsiya migratsiyasidan keyin SQL Editor'da ishga
tushiring. Kod yaratilgan vaqtdan boshlab 15 kun davomida turli qurilmalarda
ishlaydi; desktop kodlariga ta'sir qilmaydi.

Saytdagi xato va saqlangan savollarni aktivatsiya kodi akkauntiga bog'lash
uchun [`supabase_web_activation_user_progress_migration.sql`](./supabase_web_activation_user_progress_migration.sql)
faylini qayta ishlatiladigan kodlar migratsiyasidan keyin ishga tushiring.
Jadvallarga to'g'ridan-to'g'ri kirish yopiq; ilova ma'lumotlarni aktivatsiya
qilingan qurilma orqali RPC funksiyalari bilan sinxronlaydi.

Avval [`supabase_single_device_auth_migration.sql`](./supabase_single_device_auth_migration.sql)
migratsiyasini qo'llagan bo'lsangiz, bitta qurilma cheklovini olib tashlash uchun
eng oxirida
[`supabase_web_activation_unlimited_devices_migration.sql`](./supabase_web_activation_unlimited_devices_migration.sql)
faylini SQL Editor'da ishga tushiring. Sayt kodi 15 kun ichida istalgancha
brauzer va qurilmada ishlaydi; admin panelda sayt kodlari uchun qurilmani
tiklash talab qilinmaydi. Desktop kodlariga bu o'zgarish ta'sir qilmaydi.

## Install and run

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run build
```

The application requires Node.js 20.19+ or 22.12+. The panel uses RLS and the
authenticated admin profile; do not expose service-role credentials.

In **Akkaunt sozlamalari**, a `SUPER_ADMIN` can upload one shared JPG, PNG, or
WebP image (up to 12 MB) for questions that have no image. It is saved in
`app_settings` as `no_question_image_url`; after the app syncs, it takes
precedence over the bundled `namuna.png`. Clearing the setting restores the
bundled image.

The question image editor can detect and clean only the OsonPrava mark in the
bottom-right corner of JPG, PNG, and WebP files before upload. Center watermarks
and car-plate text are left unchanged. This runs locally in the browser; the
checkbox can be turned off, and URLs are not modified.

## Base source data

The canonical Base schema is stored in `base_sections`, `base_lessons`,
`base_questions`, `base_answers`, `base_question_images`,
`base_orphan_answers`, and `base_import_metadata`. It preserves localized
strings and the source IDs. Admin policies protect direct table access;
desktop clients receive content through activation-checked sync RPCs.

The supplied source contains 4 sections, 30 lessons, 1,153 questions, 3,552
linked answers, 209 orphan answers, and no exam variants. The setup also keeps
a compatibility projection for the existing UUID-based admin pages.

## Admin redesign migration and desktop sync contract

After the existing schema/setup is installed, run
[`supabase_admin_redesign_migration.sql`](./supabase_admin_redesign_migration.sql)
in Dashboard → SQL Editor **before deploying this frontend**. The migration is
additive and rerunnable; it does not replace the original setup file or edit
the desktop project. It adds soft-delete and classification fields, localized
admin-question fields, and manual-variant tables/RLS policies. `base_exam_variants`
is left untouched so imported/automatic variants remain separate. The migration
also provides admin-only functions to delete a topic while keeping and
unassigning its questions, and to move a topic one place up or down within its
section while renumbering the active topics. Re-run the migration when updating
an existing database to install these functions.

To reorder questions within a topic, run
[`supabase_lesson_question_order_migration.sql`](./supabase_lesson_question_order_migration.sql)
in Dashboard → SQL Editor before deploying the updated admin panel and website.
The migration adds a shared lesson order for base and admin-added questions,
admin-only move permissions, and a website sync endpoint so tests use the saved
order. It does not change the desktop application.

The desktop sync contract is:

- `base_questions`: `is_new`, `is_numeric`, `is_similar` are explicit booleans
  (all default false); `lesson_id` can be null independently. `explanation` is
  nullable localized JSONB. Existing `question_type` remains for compatibility.
- `admin_new_questions`: `is_new` defaults true; `is_numeric` and `is_similar`
  default false. `text_i18n` and nullable `explanation_i18n` are JSON objects
  with `uz-Latn`, `uz-Cyrl`, `ru` keys. `options_i18n` is an ordered JSON array
  of objects with the same keys. Existing plain-text `text`, `options`, and
  `explanation` remain populated for older consumers.
- `base_manual_variants` columns are `id bigint`, `title jsonb`,
  `sort_order integer`, `is_deleted boolean`, `created_at`, and `updated_at`.
  `base_manual_variant_questions` stores normalized membership as
  `(variant_id, question_source, question_id, sort_order)`, where
  `question_source` is `base` or `admin_new`.
- `sync_base_questions` keeps the arguments and defaults
  `(p_device_id text, p_since timestamptz DEFAULT 'epoch',
  p_after_id bigint DEFAULT 0, p_limit integer DEFAULT 500)`. Its full return
  columns, in order, are `id bigint`, `question_type text`, `lesson_id bigint`,
  `sort_order integer`, `text jsonb`, `created_at timestamptz`,
  `updated_at timestamptz`, `explanation jsonb`, `answers jsonb`, `images jsonb`,
  `is_deleted boolean`, `is_new boolean`, `is_numeric boolean`,
  `is_similar boolean`, `question_source text`, `manual_variant_ids bigint[]`,
  `manual_variant_memberships jsonb`. The source is `base` or `admin_new`;
  admin-new rows use a negative RPC `id` so their incremental cursor cannot
  collide with a base-question ID; the desktop stores that same negative ID
  locally. The underlying admin table IDs and membership IDs remain positive.
  membership objects are ordered as `[{"variant_id":12,"sort_order":3}]`.
  Classification flags are not inferred from section, lesson, text, or
  `question_type`.
- `sync_base_catalog(p_device_id text, p_since timestamptz)` retains its current
  keys and adds `manual_variants`, an array of objects with
  `{id bigint,title jsonb,sort_order integer,is_deleted boolean,updated_at
  timestamptz}`. Each section object is `{id,sort_order,name,is_deleted,
  created_at,updated_at}`; each lesson is
  `{id,section_id,sort_order,title,is_deleted,created_at,updated_at}`. Existing
  `settings` and `server_time` keys are unchanged; settings include
  `no_question_image_url` when configured.
- In the question RPC, `text` and non-null `explanation` are localized objects;
  each `answers` entry retains `{id,sort_order,text,is_correct,created_at,
  updated_at}` and each base `images` entry retains
  `{id,role,path,source_path,storage_path,status,link_basis}`. Admin-added
  question images also retain their existing `storage_url` field. The activation
  check remains in place. Direct admin CRUD remains protected by
  authenticated-admin RLS; no service-role key is used by the frontend.

## Other SQL files

- `supabase_full_setup.sql` — schema, RLS, activation, admin functions, and sync.
- `supabase_admin_redesign_migration.sql` — additive admin and desktop-sync contract.
- `supabase_lesson_question_order_migration.sql` — persistent topic question ordering.
- `supabase_auth_profile_setup.sql` — optional admin profile editing.
- `supabase_activation_code_fix.sql` — optional crypto search-path fix.
- `../Base/question_bank_seed.sql` — generated data seed for the source JSON.
