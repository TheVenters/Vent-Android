-- Add explicit optional lead-admin pointer with fallback inference.
-- Default lead remains inferred (earliest accepted admin) when pointer is null.
-- Lead admins can transfer lead role to another accepted member.

alter table public.communities
  add column if not exists lead_admin_user_id uuid references auth.users(id) on delete set null;

create index if not exists communities_lead_admin_user_id_idx
  on public.communities(lead_admin_user_id);

-- Backfill explicit lead for existing communities where possible.
update public.communities c
set lead_admin_user_id = sub.user_id
from (
  select distinct on (cm.community_id)
    cm.community_id,
    cm.user_id
  from public.community_members cm
  where cm.status = 'accepted'
    and cm.role = 'admin'
  order by cm.community_id, cm.created_at asc, cm.user_id asc
) as sub
where c.id = sub.community_id
  and c.lead_admin_user_id is null;

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
            and cm.status = 'accepted'
            and cm.role = 'admin'
          limit 1
        ),
        (
          select cm.user_id
          from public.community_members cm
          where cm.community_id = c.id
            and cm.status = 'accepted'
            and cm.role = 'admin'
          order by cm.created_at asc, cm.user_id asc
          limit 1
        )
      ) as lead_user_id
    from public.communities c
    where c.id = p_community_id
  )
  select exists (
    select 1
    from lead_choice lc
    where lc.lead_user_id is not null
      and lc.lead_user_id = auth.uid()
  );
$$;

create or replace function public.guard_community_lead_admin_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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

drop trigger if exists community_lead_admin_guard on public.communities;
create trigger community_lead_admin_guard
  before update on public.communities
  for each row
  execute function public.guard_community_lead_admin_update();

create or replace function public.transfer_community_lead_admin(
  p_community_id uuid,
  p_target_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_member boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_community_id is null then
    raise exception 'Community id is required';
  end if;

  if p_target_user_id is null then
    raise exception 'Target user id is required';
  end if;

  if not public.is_community_lead_admin(p_community_id) then
    raise exception 'Only the lead admin can transfer lead admin role';
  end if;

  select exists (
    select 1
    from public.community_members cm
    where cm.community_id = p_community_id
      and cm.user_id = p_target_user_id
      and cm.status = 'accepted'
  )
  into v_is_member;

  if not v_is_member then
    raise exception 'Target user must be an accepted community member';
  end if;

  update public.community_members
  set role = 'admin',
      updated_at = now()
  where community_id = p_community_id
    and user_id = p_target_user_id
    and status = 'accepted'
    and role <> 'admin';

  update public.communities
  set lead_admin_user_id = p_target_user_id
  where id = p_community_id;

  return found;
end;
$$;

revoke all on function public.transfer_community_lead_admin(uuid, uuid) from public;
grant execute on function public.transfer_community_lead_admin(uuid, uuid) to authenticated;
