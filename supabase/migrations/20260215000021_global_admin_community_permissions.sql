-- Grant platform admins (profiles.is_admin = true) full community permissions.
-- This applies across membership/admin/lead-admin checks.

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
    where p.id = auth.uid()
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
        and cm.user_id = auth.uid()
        and cm.status = 'accepted'
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
        and cm.status = 'accepted'
        and cm.role = 'admin'
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
  select
    public.is_global_admin()
    or exists (
      select 1
      from lead_choice lc
      where lc.lead_user_id is not null
        and lc.lead_user_id = auth.uid()
    );
$$;

revoke all on function public.is_global_admin() from public;
grant execute on function public.is_global_admin() to authenticated, anon;
