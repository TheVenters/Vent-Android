-- File purpose: Supabase migration that applies the database change described by 20260217000001_rls_request_user_id_fallback_community_messages.sql.

-- ============================================================================
-- Restore community join + messaging writes when auth.uid() is intermittently
-- null by using request_user_id() fallback in RLS/function checks.
-- ============================================================================

-- Direct messages RLS: use fallback actor id consistently.
drop policy if exists "Users can view their own messages" on public.messages;
create policy "Users can view their own messages"
  on public.messages for select
  using (
    public.request_user_id() = sender_id
    or public.request_user_id() = receiver_id
  );

drop policy if exists "Users can send messages to friends" on public.messages;
create policy "Users can send messages to friends"
  on public.messages for insert
  with check (
    public.request_user_id() = sender_id
    and exists (
      select 1
      from public.friends f
      where f.status = 'accepted'
        and (
          (f.user_id = public.request_user_id() and f.friend_id = receiver_id)
          or (f.friend_id = public.request_user_id() and f.user_id = receiver_id)
        )
    )
  );

drop policy if exists "Users can update messages they received" on public.messages;
create policy "Users can update messages they received"
  on public.messages for update
  using (public.request_user_id() = receiver_id)
  with check (public.request_user_id() = receiver_id);

drop policy if exists "Users can delete their own messages" on public.messages;
create policy "Users can delete their own messages"
  on public.messages for delete
  using (public.request_user_id() = sender_id);

-- Community auth helpers: resolve actor id via request_user_id().
create or replace function public.is_global_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = public.request_user_id()
      and coalesce(p.is_admin, false) = true
  );
$$;

create or replace function public.is_community_member(
  p_community_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_global_admin()
    or exists (
      select 1
      from public.community_members cm
      where cm.community_id = p_community_id
        and cm.user_id = public.request_user_id()
        and cm.status in ('accepted', 'active')
    );
$$;

create or replace function public.is_community_admin(
  p_community_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_global_admin()
    or exists (
      select 1
      from public.community_members cm
      where cm.community_id = p_community_id
        and cm.user_id = public.request_user_id()
        and cm.status in ('accepted', 'active')
        and cm.role in ('admin', 'owner', 'mod')
    );
$$;

create or replace function public.is_community_lead_admin(
  p_community_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with lead_choice as (
    select
      c.id as community_id,
      coalesce(
        (
          select cm.user_id
          from public.community_members cm
          where cm.community_id = c.id
            and cm.user_id = c.lead_admin_user_id
            and cm.status in ('accepted', 'active')
            and cm.role in ('admin', 'owner', 'mod')
          limit 1
        ),
        (
          select cm.user_id
          from public.community_members cm
          where cm.community_id = c.id
            and cm.status in ('accepted', 'active')
            and cm.role in ('admin', 'owner', 'mod')
          order by cm.created_at asc, cm.user_id asc
          limit 1
        )
      ) as lead_user_id
    from public.communities c
    where c.id = p_community_id
  )
  select
    public.is_global_admin()
    or exists (
      select 1
      from lead_choice lc
      where lc.lead_user_id is not null
        and lc.lead_user_id = public.request_user_id()
    );
$$;

-- Community membership/chat policies: use fallback actor id.
drop policy if exists "Members can view their community membership records"
  on public.community_members;
create policy "Members can view their community membership records"
  on public.community_members
  for select
  using (
    public.request_user_id() = user_id
    or public.is_community_member(community_id)
  );

drop policy if exists "Users can request to join communities"
  on public.community_members;
create policy "Users can request to join communities"
  on public.community_members
  for insert
  with check (
    public.request_user_id() = user_id
    and (
      (status = 'accepted' and role = 'member')
      or (status = 'pending' and role = 'member')
      or (
        status = 'accepted'
        and role = 'admin'
        and public.community_member_count(community_id) = 0
      )
    )
  );

drop policy if exists "Users can leave and admins can remove members"
  on public.community_members;
create policy "Users can leave and admins can remove members"
  on public.community_members
  for delete
  using (
    public.request_user_id() = user_id
    or public.is_community_admin(community_id)
  );

drop policy if exists "Community members can send group chat messages"
  on public.community_messages;
create policy "Community members can send group chat messages"
  on public.community_messages
  for insert
  with check (
    public.request_user_id() = sender_id
    and public.is_community_member(community_id)
  );

drop policy if exists "Senders and admins can delete group chat messages"
  on public.community_messages;
create policy "Senders and admins can delete group chat messages"
  on public.community_messages
  for delete
  using (
    public.request_user_id() = sender_id
    or public.is_community_admin(community_id)
  );

drop policy if exists "Authenticated users can create communities"
  on public.communities;
create policy "Authenticated users can create communities"
  on public.communities
  for insert
  with check (public.request_user_id() is not null);
