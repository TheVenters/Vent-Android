-- Ensure lead-admin resolution requires accepted admin membership,
-- and prevent non-lead-admin users from changing lead_admin_user_id directly.

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
