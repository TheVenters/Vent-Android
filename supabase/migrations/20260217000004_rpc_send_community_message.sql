-- File purpose: Supabase migration that applies the database change described by 20260217000004_rpc_send_community_message.sql.

-- RPC for sending community chat messages, bypassing table-level RLS.

create or replace function public.send_community_message(
  p_community_id uuid,
  p_content      text
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

  if p_community_id is null or p_content is null or trim(p_content) = '' then
    raise exception 'community_id and content are required'
      using errcode = '22023';
  end if;

  -- Verify accepted membership
  if not exists (
    select 1
    from public.community_members cm
    where cm.community_id = p_community_id
      and cm.user_id = actor
      and cm.status in ('accepted', 'active')
  ) and not public.is_global_admin() then
    raise exception 'You must be an accepted community member to send messages'
      using errcode = '42501';
  end if;

  insert into public.community_messages (community_id, sender_id, content)
  values (p_community_id, actor, trim(p_content))
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.send_community_message(uuid, text) from public;
grant execute on function public.send_community_message(uuid, text) to authenticated;
grant execute on function public.send_community_message(uuid, text) to anon;
