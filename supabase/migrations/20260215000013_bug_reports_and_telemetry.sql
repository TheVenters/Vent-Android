-- ============================================================================
-- Client telemetry + bug reports
-- ============================================================================

create table if not exists public.client_issue_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  category text not null check (category in ('bug_report', 'js_error', 'unhandled_rejection')),
  severity text not null default 'error' check (severity in ('info', 'warning', 'error', 'fatal')),
  title text,
  description text,
  current_screen text,
  app_version text,
  app_build text,
  platform text,
  device_info text,
  screenshot_path text,
  stack text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists client_issue_reports_created_at_idx
  on public.client_issue_reports(created_at desc);
create index if not exists client_issue_reports_user_id_idx
  on public.client_issue_reports(user_id);
create index if not exists client_issue_reports_category_idx
  on public.client_issue_reports(category);
alter table public.client_issue_reports enable row level security;
drop policy if exists "Users can insert client issue reports" on public.client_issue_reports;
create policy "Users can insert client issue reports"
  on public.client_issue_reports
  for insert
  with check (
    (
      public.request_user_id() is null
      and user_id is null
    )
    or public.request_user_id() = user_id
  );
drop policy if exists "Users can view their own client issue reports" on public.client_issue_reports;
create policy "Users can view their own client issue reports"
  on public.client_issue_reports
  for select
  using (
    public.request_user_id() is not null
    and user_id = public.request_user_id()
  );
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bug-report-screenshots',
  'bug-report-screenshots',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;
drop policy if exists "Users can upload bug report screenshots" on storage.objects;
create policy "Users can upload bug report screenshots"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'bug-report-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists "Users can read bug report screenshots" on storage.objects;
create policy "Users can read bug report screenshots"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'bug-report-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
