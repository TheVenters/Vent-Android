-- ============================================================================
-- Pin comments with visibility-aligned access
-- Supports legacy pin_comments schemas that used author_id/text fields.
-- ============================================================================

create table if not exists public.pin_comments (
  id uuid primary key default gen_random_uuid(),
  pin_id uuid not null references public.pins(id) on delete cascade,
  user_id uuid,
  content text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.pin_comments
  add column if not exists user_id uuid;
alter table public.pin_comments
  add column if not exists content text;
alter table public.pin_comments
  add column if not exists updated_at timestamptz not null default now();
do $$
begin
  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'pin_comments'
      and c.column_name = 'author_id'
  ) then
    execute $sql$
      update public.pin_comments
      set user_id = author_id
      where user_id is null
    $sql$;
  end if;
end $$;
do $$
begin
  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'pin_comments'
      and c.column_name = 'text'
  ) then
    execute $sql$
      update public.pin_comments
      set content = text
      where content is null or btrim(content) = ''
    $sql$;
  end if;
end $$;
update public.pin_comments
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;
alter table public.pin_comments
  alter column updated_at set not null;
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pin_comments_user_id_fkey'
  ) then
    alter table only public.pin_comments
      add constraint pin_comments_user_id_fkey
      foreign key (user_id)
      references auth.users(id)
      on delete cascade;
  end if;
end $$;
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pin_comments_pin_id_fkey'
  ) then
    alter table only public.pin_comments
      add constraint pin_comments_pin_id_fkey
      foreign key (pin_id)
      references public.pins(id)
      on delete cascade;
  end if;
end $$;
create index if not exists pin_comments_pin_created_idx
  on public.pin_comments(pin_id, created_at);
create index if not exists pin_comments_user_created_idx
  on public.pin_comments(user_id, created_at);
alter table public.pin_comments enable row level security;
create or replace function public.can_comment_on_pin(target_pin_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.request_user_id() is not null
    and public.can_view_pin_for_votes(target_pin_id);
$$;
revoke all on function public.can_comment_on_pin(uuid) from public;
grant execute on function public.can_comment_on_pin(uuid) to anon;
grant execute on function public.can_comment_on_pin(uuid) to authenticated;
grant execute on function public.can_comment_on_pin(uuid) to service_role;
drop policy if exists "Users can view comments for visible pins" on public.pin_comments;
create policy "Users can view comments for visible pins"
  on public.pin_comments for select
  using (public.can_view_pin_for_votes(pin_id));
drop policy if exists "Users can insert comments for visible pins" on public.pin_comments;
create policy "Users can insert comments for visible pins"
  on public.pin_comments for insert
  with check (
    public.request_user_id() = user_id
    and public.can_comment_on_pin(pin_id)
  );
drop policy if exists "Users can update their own pin comments" on public.pin_comments;
create policy "Users can update their own pin comments"
  on public.pin_comments for update
  using (public.request_user_id() = user_id)
  with check (public.request_user_id() = user_id);
drop policy if exists "Users can delete their own pin comments" on public.pin_comments;
create policy "Users can delete their own pin comments"
  on public.pin_comments for delete
  using (public.request_user_id() = user_id);
drop trigger if exists pin_comments_updated_at on public.pin_comments;
create trigger pin_comments_updated_at
  before update on public.pin_comments
  for each row execute function public.update_updated_at();
alter publication supabase_realtime add table public.pin_comments;
