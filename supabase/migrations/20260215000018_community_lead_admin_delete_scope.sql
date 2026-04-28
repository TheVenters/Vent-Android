-- File purpose: Supabase migration that applies the database change described by 20260215000018_community_lead_admin_delete_scope.sql.

-- Tighten community delete scope: only lead admin (first accepted admin member)
-- can delete a community. Regular admins still manage layers.

create or replace function public.is_community_lead_admin(
  p_community_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select cm.user_id = auth.uid()
    from public.community_members cm
    where cm.community_id = p_community_id
      and cm.status = 'accepted'
      and cm.role = 'admin'
    order by cm.created_at asc, cm.user_id asc
    limit 1
  ), false);
$$;
create or replace function public.delete_community_with_layers(
  p_community_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layer_id uuid;
  v_deleted boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_community_id is null then
    raise exception 'Community id is required';
  end if;

  if not public.is_community_lead_admin(p_community_id) then
    raise exception 'Only the lead admin can delete communities';
  end if;

  for v_layer_id in
    select id
    from public.layers
    where owner_type = 'community'
      and owner_id = p_community_id
  loop
    perform public.delete_community_layer(v_layer_id);
  end loop;

  delete from public.communities
  where id = p_community_id;

  v_deleted := found;
  return v_deleted;
end;
$$;
drop policy if exists "Community admins can delete communities"
  on public.communities;
drop policy if exists "Community lead admins can delete communities"
  on public.communities;
create policy "Community lead admins can delete communities"
  on public.communities
  for delete
  using (public.is_community_lead_admin(id));
revoke all on function public.is_community_lead_admin(uuid) from public;
grant execute on function public.is_community_lead_admin(uuid) to authenticated, anon;
