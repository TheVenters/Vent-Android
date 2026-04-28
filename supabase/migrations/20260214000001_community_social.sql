-- File purpose: Supabase migration that applies the database change described by 20260214000001_community_social.sql.

-- ============================================================================
-- Community Social Features: memberships, join requests, group chat
-- ============================================================================

create table if not exists public.community_members (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (community_id, user_id)
);
create index if not exists community_members_community_id_idx
  on public.community_members(community_id);
create index if not exists community_members_user_id_idx
  on public.community_members(user_id);
create index if not exists community_members_status_idx
  on public.community_members(status);
create table if not exists public.community_messages (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists community_messages_community_id_idx
  on public.community_messages(community_id);
create index if not exists community_messages_sender_id_idx
  on public.community_messages(sender_id);
create index if not exists community_messages_created_at_idx
  on public.community_messages(created_at desc);
create or replace function public.community_member_count(p_community_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.community_members
  where community_id = p_community_id;
$$;
create or replace function public.is_community_member(p_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.community_members cm
    where cm.community_id = p_community_id
      and cm.user_id = auth.uid()
      and cm.status = 'accepted'
  );
$$;
create or replace function public.is_community_admin(p_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.community_members cm
    where cm.community_id = p_community_id
      and cm.user_id = auth.uid()
      and cm.status = 'accepted'
      and cm.role = 'admin'
  );
$$;
grant execute on function public.community_member_count(uuid) to authenticated, anon;
grant execute on function public.is_community_member(uuid) to authenticated, anon;
grant execute on function public.is_community_admin(uuid) to authenticated, anon;
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.community_messages enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'communities'
      and policyname = 'Communities are viewable by everyone'
  ) then
    create policy "Communities are viewable by everyone"
      on public.communities for select
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'communities'
      and policyname = 'Authenticated users can create communities'
  ) then
    create policy "Authenticated users can create communities"
      on public.communities for insert
      with check (auth.uid() is not null);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'communities'
      and policyname = 'Community admins can update communities'
  ) then
    create policy "Community admins can update communities"
      on public.communities for update
      using (public.is_community_admin(id))
      with check (public.is_community_admin(id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'communities'
      and policyname = 'Community admins can delete communities'
  ) then
    create policy "Community admins can delete communities"
      on public.communities for delete
      using (public.is_community_admin(id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'community_members'
      and policyname = 'Members can view their community membership records'
  ) then
    create policy "Members can view their community membership records"
      on public.community_members for select
      using (
        auth.uid() = user_id
        or public.is_community_member(community_id)
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'community_members'
      and policyname = 'Users can request to join communities'
  ) then
    create policy "Users can request to join communities"
      on public.community_members for insert
      with check (
        auth.uid() = user_id
        and (
          (status = 'pending' and role = 'member')
          or (
            status = 'accepted'
            and role = 'admin'
            and public.community_member_count(community_id) = 0
          )
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'community_members'
      and policyname = 'Community admins can update memberships'
  ) then
    create policy "Community admins can update memberships"
      on public.community_members for update
      using (public.is_community_admin(community_id))
      with check (public.is_community_admin(community_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'community_members'
      and policyname = 'Users can leave and admins can remove members'
  ) then
    create policy "Users can leave and admins can remove members"
      on public.community_members for delete
      using (
        auth.uid() = user_id
        or public.is_community_admin(community_id)
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'community_messages'
      and policyname = 'Community members can view group chat'
  ) then
    create policy "Community members can view group chat"
      on public.community_messages for select
      using (public.is_community_member(community_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'community_messages'
      and policyname = 'Community members can send group chat messages'
  ) then
    create policy "Community members can send group chat messages"
      on public.community_messages for insert
      with check (
        auth.uid() = sender_id
        and public.is_community_member(community_id)
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'community_messages'
      and policyname = 'Senders and admins can delete group chat messages'
  ) then
    create policy "Senders and admins can delete group chat messages"
      on public.community_messages for delete
      using (
        auth.uid() = sender_id
        or public.is_community_admin(community_id)
      );
  end if;
end
$$;
drop trigger if exists community_members_updated_at on public.community_members;
create trigger community_members_updated_at
  before update on public.community_members
  for each row execute function public.update_updated_at();
alter publication supabase_realtime add table public.community_members;
alter publication supabase_realtime add table public.community_messages;
alter table public.community_members replica identity full;
alter table public.community_messages replica identity full;
