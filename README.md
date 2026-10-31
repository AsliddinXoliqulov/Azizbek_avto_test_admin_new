# PDD admin panel

React + Vite + TypeScript admin web panel. The Electron desktop app is built
from the repository root; this folder contains the independent content/admin
panel and the Supabase setup scripts.

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

## Install and run

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run build
```

The application requires Node.js 20.19+ or 22.12+. The panel uses RLS and the
authenticated admin profile; do not expose service-role credentials.

## Base source data

The canonical Base schema is stored in `base_sections`, `base_lessons`,
`base_questions`, `base_answers`, `base_question_images`,
`base_orphan_answers`, and `base_import_metadata`. It preserves localized
strings and the source IDs. Admin policies protect direct table access;
desktop clients receive content through activation-checked sync RPCs.

The supplied source contains 4 sections, 30 lessons, 1,153 questions, 3,552
linked answers, 209 orphan answers, and no exam variants. The setup also keeps
a compatibility projection for the existing UUID-based admin pages.

## Other SQL files

- `supabase_full_setup.sql` — schema, RLS, activation, admin functions, and sync.
- `supabase_auth_profile_setup.sql` — optional admin profile editing.
- `supabase_activation_code_fix.sql` — optional crypto search-path fix.
- `../Base/question_bank_seed.sql` — generated data seed for the source JSON.
