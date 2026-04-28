-- File purpose: Supabase migration that applies the database change described by 20260215000017_community_admin_management_rpcs.sql.

-- Admin-scoped community management RPCs.
-- These centralize permission checks and cleanup for community layer/community deletion.

create or replace function public.create_community_layer(
  p_community_id uuid,
  p_name text,
  p_kind text default 'user_overlay'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layer_id uuid;
  v_next_sort int;
  v_name text;
  v_kind text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_community_id is null then
    raise exception 'Community id is required';
  end if;

  if not public.is_community_admin(p_community_id) then
    raise exception 'Only community admins can create community layers';
  end if;

  v_name := trim(coalesce(p_name, ''));
  if v_name = '' then
    raise exception 'Layer name is required';
  end if;

  v_kind := trim(coalesce(p_kind, ''));
  if v_kind = '' then
    v_kind := 'user_overlay';
  end if;

  select coalesce(max(sort_order), 0) + 1
    into v_next_sort
  from public.community_layers
  where community_id = p_community_id;

  insert into public.layers (
    name,
    kind,
    enabled,
    owner_type,
    owner_id,
    is_public
  )
  values (
    v_name,
    v_kind,
    true,
    'community',
    p_community_id,
    true
  )
  returning id into v_layer_id;

  insert into public.community_layers (
    community_id,
    layer_id,
    enabled,
    sort_order
  )
  values (
    p_community_id,
    v_layer_id,
    true,
    v_next_sort
  )
  on conflict (community_id, layer_id) do update
    set enabled = excluded.enabled,
        sort_order = excluded.sort_order;

  return v_layer_id;
end;
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
create or replace function public.delete_community_layer(
  p_layer_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_type text;
  v_community_id uuid;
  v_deleted boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_layer_id is null then
    raise exception 'Layer id is required';
  end if;

  select owner_type, owner_id
    into v_owner_type, v_community_id
  from public.layers
  where id = p_layer_id;

  if v_owner_type is null then
    return false;
  end if;

  if v_owner_type <> 'community' or v_community_id is null then
    raise exception 'Only community-owned layers can be deleted with this RPC';
  end if;

  if not public.is_community_admin(v_community_id) then
    raise exception 'Only community admins can delete community layers';
  end if;

  delete from public.pins
  where coalesce(geometry->>'layer_id', '') = p_layer_id::text;

  delete from public.overlay_features
  where layer_id = p_layer_id;

  if to_regclass('public.user_layer_prefs') is not null then
    execute 'delete from public.user_layer_prefs where layer_id = $1'
      using p_layer_id;
  end if;

  delete from public.community_layers
  where layer_id = p_layer_id;

  delete from public.layers
  where id = p_layer_id;

  v_deleted := found;
  return v_deleted;
end;
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
revoke all on function public.create_community_layer(uuid, text, text) from public;
revoke all on function public.delete_community_layer(uuid) from public;
revoke all on function public.delete_community_with_layers(uuid) from public;
revoke all on function public.is_community_lead_admin(uuid) from public;
grant execute on function public.create_community_layer(uuid, text, text) to authenticated;
grant execute on function public.delete_community_layer(uuid) to authenticated;
grant execute on function public.delete_community_with_layers(uuid) to authenticated;
grant execute on function public.is_community_lead_admin(uuid) to authenticated, anon;
