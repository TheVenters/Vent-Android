-- Backfill legacy community membership values so chat/membership RLS checks work
-- consistently for older rows.

update public.community_members
set status = 'accepted',
    updated_at = now()
where lower(coalesce(status, '')) = 'active';

update public.community_members
set role = 'admin',
    updated_at = now()
where lower(coalesce(role, '')) in ('owner', 'mod');

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
        and cm.user_id = auth.uid()
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
        and cm.user_id = auth.uid()
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
        and lc.lead_user_id = auth.uid()
    );
$$;
