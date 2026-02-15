-- ============================================================================
-- Pin comments: allow signed-in non-authors to comment on visible pins
-- ============================================================================

create table if not exists public.pin_comments (
  id uuid primary key default gen_random_uuid(),
  pin_id uuid not null references public.pins(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(btrim(content)) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pin_comments_pin_id_created_at_idx
  on public.pin_comments(pin_id, created_at asc);
create index if not exists pin_comments_user_id_idx
  on public.pin_comments(user_id);

alter table public.pin_comments enable row level security;

drop policy if exists "Users can view comments for visible pins" on public.pin_comments;
create policy "Users can view comments for visible pins"
  on public.pin_comments
  for select
  using (public.can_view_pin_for_votes(pin_id));

drop policy if exists "Users can add comments to visible pins they do not own" on public.pin_comments;
create policy "Users can add comments to visible pins they do not own"
  on public.pin_comments
  for insert
  with check (
    public.request_user_id() is not null
    and public.request_user_id() = user_id
    and public.can_view_pin_for_votes(pin_id)
    and exists (
      select 1
      from public.pins p
      where p.id = pin_comments.pin_id
        and p.user_id <> public.request_user_id()
    )
  );

drop policy if exists "Users can delete their own comments" on public.pin_comments;
create policy "Users can delete their own comments"
  on public.pin_comments
  for delete
  using (
    public.request_user_id() is not null
    and user_id = public.request_user_id()
  );

create trigger pin_comments_updated_at
  before update on public.pin_comments
  for each row execute function public.update_updated_at();

alter publication supabase_realtime add table public.pin_comments;
