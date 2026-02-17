-- ============================================================================
-- RPC functions for message sending and community joining.
-- These bypass table-level RLS and perform equivalent security checks in the
-- function body, avoiding intermittent auth.uid() / request_user_id() nulls
-- that cause false 42501 denials through row-level policies.
-- ============================================================================

-- 1. Send a direct message to a friend.
create or replace function public.send_direct_message(
  p_receiver_id uuid,
  p_content     text
)
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  actor uuid := public.request_user_id();
  new_id uuid;
begin
  if actor is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  if p_receiver_id is null or p_content is null or trim(p_content) = '' then
    raise exception 'receiver_id and content are required'
      using errcode = '22023';
  end if;

  if actor = p_receiver_id then
    raise exception 'Cannot message yourself'
      using errcode = '22023';
  end if;

  -- Verify accepted friendship
  if not exists (
    select 1
    from public.friends f
    where f.status in ('accepted', 'active')
      and (
        (f.user_id = actor and f.friend_id = p_receiver_id)
        or (f.friend_id = actor and f.user_id = p_receiver_id)
      )
  ) then
    raise exception 'You can only message accepted friends'
      using errcode = '42501';
  end if;

  insert into public.messages (sender_id, receiver_id, content)
  values (actor, p_receiver_id, trim(p_content))
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.send_direct_message(uuid, text) from public;
grant execute on function public.send_direct_message(uuid, text) to authenticated;
grant execute on function public.send_direct_message(uuid, text) to anon;

-- 2. Join a community as a member.
create or replace function public.join_community(
  p_community_id uuid
)
returns text  -- returns the resulting membership status ('accepted' or 'pending')
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  actor uuid := public.request_user_id();
  existing_status text;
begin
  if actor is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  if p_community_id is null then
    raise exception 'community_id is required'
      using errcode = '22023';
  end if;

  -- Check if already a member
  select cm.status into existing_status
  from public.community_members cm
  where cm.community_id = p_community_id
    and cm.user_id = actor;

  if existing_status = 'accepted' then
    return 'accepted';  -- already joined
  end if;

  -- Remove any pending row so we can re-insert
  if existing_status is not null then
    delete from public.community_members
    where community_id = p_community_id
      and user_id = actor;
  end if;

  -- Insert as accepted member
  insert into public.community_members (user_id, community_id, role, status)
  values (actor, p_community_id, 'member', 'accepted')
  on conflict (user_id, community_id) do update
    set status = 'accepted',
        updated_at = now();

  return 'accepted';
end;
$$;

revoke all on function public.join_community(uuid) from public;
grant execute on function public.join_community(uuid) to authenticated;
grant execute on function public.join_community(uuid) to anon;
