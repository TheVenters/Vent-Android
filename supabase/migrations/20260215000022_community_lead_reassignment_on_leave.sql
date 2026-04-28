-- File purpose: Supabase migration that applies the database change described by 20260215000022_community_lead_reassignment_on_leave.sql.

-- Automatically reassign lead admin when the current lead leaves or stops
-- being an accepted admin member.
--
-- Selection rule:
-- 1) Highest-interaction accepted admin member.
-- 2) If none, highest-interaction accepted member (promoted to admin).
--
-- Interaction score currently combines:
-- - community_messages sent in the community
-- - pins posted into layers owned by the community
-- - comments on pins posted into layers owned by the community

create or replace function public.guard_community_lead_admin_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.bypass_lead_admin_guard', true) = '1' then
    return new;
  end if;

  if new.lead_admin_user_id is distinct from old.lead_admin_user_id then
    if auth.uid() is null then
      raise exception 'Not authenticated';
    end if;

    if not public.is_community_lead_admin(old.id) then
      raise exception 'Only the lead admin can transfer lead admin role';
    end if;

    if new.lead_admin_user_id is not null and not exists (
      select 1
      from public.community_members cm
      where cm.community_id = old.id
        and cm.user_id = new.lead_admin_user_id
        and cm.status = 'accepted'
        and cm.role = 'admin'
    ) then
      raise exception 'Lead admin must be an accepted admin member';
    end if;
  end if;

  return new;
end;
$$;
create or replace function public.community_member_interaction_score(
  p_community_id uuid,
  p_user_id uuid
)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_messages bigint := 0;
  v_pins bigint := 0;
  v_comments bigint := 0;
begin
  if p_community_id is null or p_user_id is null then
    return 0;
  end if;

  select count(*)::bigint
    into v_messages
  from public.community_messages cm
  where cm.community_id = p_community_id
    and cm.sender_id = p_user_id;

  begin
    execute $sql$
      select count(*)::bigint
      from public.pins p
      join public.layers l
        on l.id::text = coalesce(p.geometry->>'layer_id', '')
       and l.owner_type = 'community'
       and l.owner_id = $1
      where p.user_id = $2
    $sql$
    into v_pins
    using p_community_id, p_user_id;
  exception
    when others then
      v_pins := 0;
  end;

  begin
    execute $sql$
      select count(*)::bigint
      from public.pin_comments pc
      join public.pins p on p.id = pc.pin_id
      join public.layers l
        on l.id::text = coalesce(p.geometry->>'layer_id', '')
       and l.owner_type = 'community'
       and l.owner_id = $1
      where pc.user_id = $2
    $sql$
    into v_comments
    using p_community_id, p_user_id;
  exception
    when others then
      v_comments := 0;
  end;

  return coalesce(v_messages, 0) + coalesce(v_pins, 0) + coalesce(v_comments, 0);
end;
$$;
create or replace function public.reassign_community_lead_admin(
  p_community_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_lead uuid;
  v_current_lead_valid boolean := false;
  v_candidate uuid;
  v_candidate_was_admin boolean := false;
begin
  if p_community_id is null then
    return null;
  end if;

  select c.lead_admin_user_id
    into v_current_lead
  from public.communities c
  where c.id = p_community_id;

  if not found then
    return null;
  end if;

  if v_current_lead is not null then
    select exists (
      select 1
      from public.community_members cm
      where cm.community_id = p_community_id
        and cm.user_id = v_current_lead
        and cm.status = 'accepted'
        and cm.role = 'admin'
    )
    into v_current_lead_valid;
  end if;

  if v_current_lead_valid then
    return v_current_lead;
  end if;

  -- First preference: accepted admins by highest interaction.
  select cm.user_id
    into v_candidate
  from public.community_members cm
  where cm.community_id = p_community_id
    and cm.status = 'accepted'
    and cm.role = 'admin'
  order by
    public.community_member_interaction_score(p_community_id, cm.user_id) desc,
    cm.created_at asc,
    cm.user_id asc
  limit 1;

  if v_candidate is not null then
    v_candidate_was_admin := true;
  else
    -- Fallback: accepted members by highest interaction, then promote to admin.
    select cm.user_id
      into v_candidate
    from public.community_members cm
    where cm.community_id = p_community_id
      and cm.status = 'accepted'
    order by
      public.community_member_interaction_score(p_community_id, cm.user_id) desc,
      cm.created_at asc,
      cm.user_id asc
    limit 1;
  end if;

  perform set_config('app.bypass_lead_admin_guard', '1', true);

  if v_candidate is null then
    update public.communities
    set lead_admin_user_id = null
    where id = p_community_id;
    return null;
  end if;

  update public.communities
  set lead_admin_user_id = v_candidate
  where id = p_community_id;

  if not v_candidate_was_admin then
    update public.community_members
    set role = 'admin',
        updated_at = now()
    where community_id = p_community_id
      and user_id = v_candidate
      and status = 'accepted'
      and role <> 'admin';
  end if;

  return v_candidate;
end;
$$;
create or replace function public.handle_community_member_change_for_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.reassign_community_lead_admin(new.community_id);
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Skip noisy updates that only touch timestamps.
    if old.community_id = new.community_id
       and old.status is not distinct from new.status
       and old.role is not distinct from new.role then
      return new;
    end if;

    perform public.reassign_community_lead_admin(old.community_id);
    if new.community_id is distinct from old.community_id then
      perform public.reassign_community_lead_admin(new.community_id);
    end if;
    return new;
  end if;

  -- DELETE
  perform public.reassign_community_lead_admin(old.community_id);
  return old;
end;
$$;
drop trigger if exists community_members_reassign_lead on public.community_members;
create trigger community_members_reassign_lead
  after insert or update or delete on public.community_members
  for each row
  execute function public.handle_community_member_change_for_lead();
-- Reconcile existing communities once with current rules.
do $$
declare
  r record;
begin
  for r in
    select id from public.communities
  loop
    perform public.reassign_community_lead_admin(r.id);
  end loop;
end
$$;
revoke all on function public.community_member_interaction_score(uuid, uuid) from public;
revoke all on function public.reassign_community_lead_admin(uuid) from public;
revoke all on function public.handle_community_member_change_for_lead() from public;
grant execute on function public.community_member_interaction_score(uuid, uuid) to authenticated, anon;
grant execute on function public.reassign_community_lead_admin(uuid) to authenticated;
