-- File purpose: Supabase SQL reference file or schema snapshot used for database setup and comparison.




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."pin_base_audience" AS ENUM (
    'public',
    'friends',
    'private'
);


ALTER TYPE "public"."pin_base_audience" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_user_id"() RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  resolved uuid;
  claim_user_id text;
  claim_email text;
begin
  resolved := auth.uid();
  if resolved is not null then
    return resolved;
  end if;

  -- Supabase access tokens typically include `sub` as the canonical user id.
  claim_user_id := coalesce(
    nullif(auth.jwt() ->> 'user_id', ''),
    nullif(auth.jwt() ->> 'id', ''),
    nullif(auth.jwt() ->> 'sub', '')
  );

  if claim_user_id is not null then
    begin
      resolved := claim_user_id::uuid;
      return resolved;
    exception
      when others then
        resolved := null;
    end;
  end if;

  claim_email := nullif(auth.jwt() ->> 'email', '');
  if claim_email is not null then
    select u.id
      into resolved
    from auth.users u
    where lower(u.email) = lower(claim_email)
    limit 1;
  end if;

  return resolved;
end;
$$;


ALTER FUNCTION "public"."request_user_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_actor_attach_layer_to_pin"("target_pin_id" "uuid", "target_layer_id" "uuid", "actor_id" "uuid" DEFAULT "public"."request_user_id"()) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
  with p as (
    select pin.id, pin.user_id
    from public.pins pin
    where pin.id = target_pin_id
  ),
  l as (
    select lay.id, coalesce(lay.owner_type, 'system') as owner_type, lay.owner_id
    from public.layers lay
    where lay.id = target_layer_id
  )
  select exists (
    select 1
    from p
    join l on true
    where actor_id is not null
      and actor_id = p.user_id
      and (
        l.owner_type = 'system'
        -- NOTE: if you later add true user-owned layers, tighten this check with owner_id/user_id.
        or (l.owner_type = 'user')
        or (
          l.owner_type = 'community'
          and l.owner_id is not null
          and (
            exists (
              select 1
              from public.community_members cm
              where cm.community_id = l.owner_id
                and cm.user_id = actor_id
                and cm.status in ('accepted', 'active')
            )
            or exists (
              select 1
              from public.profiles pr
              where pr.id = actor_id
                and coalesce(pr.is_admin, false) = true
            )
          )
        )
      )
  );
$$;


ALTER FUNCTION "public"."can_actor_attach_layer_to_pin"("target_pin_id" "uuid", "target_layer_id" "uuid", "actor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_actor_manage_layer_presentation"("target_layer_id" "uuid", "actor_id" "uuid" DEFAULT "public"."request_user_id"()) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
  with l as (
    select id, owner_type, owner_id
    from public.layers
    where id = target_layer_id
  )
  select exists (
    select 1
    from l
    where actor_id is not null
      and (
        exists (
          select 1
          from public.profiles pr
          where pr.id = actor_id
            and coalesce(pr.is_admin, false) = true
        )
        or (
          l.owner_type = 'community'
          and l.owner_id is not null
          and exists (
            select 1
            from public.community_members cm
            where cm.community_id = l.owner_id
              and cm.user_id = actor_id
              and cm.status in ('accepted', 'active')
              and cm.role = 'admin'
          )
        )
      )
  );
$$;


ALTER FUNCTION "public"."can_actor_manage_layer_presentation"("target_layer_id" "uuid", "actor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_actor_view_layer"("target_layer_id" "uuid", "actor_id" "uuid" DEFAULT "public"."request_user_id"()) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
  with l as (
    select id, owner_type, owner_id, enabled
    from public.layers
    where id = target_layer_id
  )
  select exists (
    select 1
    from l
    where l.enabled = true
      and (
        l.owner_type = 'system'
        or (
          l.owner_type = 'community'
          and l.owner_id is not null
          and actor_id is not null
          and (
            exists (
              select 1
              from public.community_members cm
              where cm.community_id = l.owner_id
                and cm.user_id = actor_id
                and cm.status in ('accepted', 'active')
            )
            or exists (
              select 1
              from public.profiles pr
              where pr.id = actor_id
                and coalesce(pr.is_admin, false) = true
            )
          )
        )
        -- NOTE: if you later implement true user-owned layers, extend here.
      )
  );
$$;


ALTER FUNCTION "public"."can_actor_view_layer"("target_layer_id" "uuid", "actor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_actor_view_pin"("target_pin_id" "uuid", "actor_id" "uuid" DEFAULT "public"."request_user_id"()) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
  select exists (
    select 1
    from public.pins p
    join public.pin_layer_memberships plm on plm.pin_id = p.id
    join public.layers l on l.id = plm.layer_id
    where p.id = target_pin_id
      and (
        (
          coalesce(l.owner_type, 'system') = 'system'
          and (
            lower(coalesce(l.kind, '')) = 'public'
            or lower(coalesce(l.name, '')) = 'public'
          )
        )
        or
        (
          coalesce(l.owner_type, 'system') = 'system'
          and (
            lower(coalesce(l.kind, '')) = 'friends'
            or lower(coalesce(l.name, '')) = 'friends'
          )
          and actor_id is not null
          and (
            actor_id = p.user_id
            or exists (
              select 1
              from public.friends f
              where f.status in ('accepted', 'active')
                and (
                  (f.user_id = actor_id and f.friend_id = p.user_id)
                  or (f.friend_id = actor_id and f.user_id = p.user_id)
                )
            )
          )
        )
        or
        (
          coalesce(l.owner_type, 'system') = 'system'
          and (
            lower(coalesce(l.kind, '')) = 'private'
            or lower(coalesce(l.name, '')) = 'private'
          )
          and actor_id is not null
          and actor_id = p.user_id
        )
        or
        (
          l.owner_type = 'community'
          and l.owner_id is not null
          and actor_id is not null
          and (
            exists (
              select 1
              from public.community_members cm
              where cm.community_id = l.owner_id
                and cm.user_id = actor_id
                and cm.status in ('accepted', 'active')
            )
            or exists (
              select 1
              from public.profiles pr
              where pr.id = actor_id
                and coalesce(pr.is_admin, false) = true
            )
          )
        )
        or
        (
          l.owner_type = 'user'
          and actor_id is not null
          and actor_id = p.user_id
        )
      )
  );
$$;


ALTER FUNCTION "public"."can_actor_view_pin"("target_pin_id" "uuid", "actor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_comment_on_pin"("target_pin_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    public.request_user_id() is not null
    and public.can_view_pin_for_votes(target_pin_id);
$$;


ALTER FUNCTION "public"."can_comment_on_pin"("target_pin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_view_pin_for_votes"("target_pin_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with actor as (
    select public.request_user_id() as uid
  )
  select exists (
    select 1
    from public.pins p
    cross join actor
    where p.id = target_pin_id
      and (
        p.layer = 'public'
        or (p.layer = 'private' and actor.uid = p.user_id)
        or (
          p.layer = 'friends'
          and (
            actor.uid = p.user_id
            or exists (
              select 1
              from public.friends f
              where f.status = 'accepted'
                and (
                  (f.user_id = actor.uid and f.friend_id = p.user_id)
                  or (f.friend_id = actor.uid and f.user_id = p.user_id)
                )
            )
          )
        )
      )
  );
$$;


ALTER FUNCTION "public"."can_view_pin_for_votes"("target_pin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_vote_on_pin"("target_pin_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with actor as (
    select public.request_user_id() as uid
  )
  select exists (
    select 1
    from public.pins p
    cross join actor
    where p.id = target_pin_id
      and actor.uid is not null
      and p.user_id <> actor.uid
  );
$$;


ALTER FUNCTION "public"."can_vote_on_pin"("target_pin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."community_member_count"("p_community_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select count(*)::integer
  from public.community_members
  where community_id = p_community_id;
$$;


ALTER FUNCTION "public"."community_member_count"("p_community_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."community_member_interaction_score"("p_community_id" "uuid", "p_user_id" "uuid") RETURNS bigint
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."community_member_interaction_score"("p_community_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_community_layer"("p_community_id" "uuid", "p_name" "text", "p_kind" "text" DEFAULT 'user_overlay'::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."create_community_layer"("p_community_id" "uuid", "p_name" "text", "p_kind" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."debug_auth_context"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
begin
  return jsonb_build_object(
    'auth_uid', auth.uid(),
    'auth_role', auth.role(),
    'request_user_id', public.request_user_id(),
    'jwt_sub', auth.jwt() ->> 'sub',
    'jwt_role', auth.jwt() ->> 'role',
    'jwt_aud', auth.jwt() ->> 'aud',
    'jwt_exp', auth.jwt() ->> 'exp',
    'has_jwt', auth.jwt() is not null
  );
end;
$$;


ALTER FUNCTION "public"."debug_auth_context"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_community_layer"("p_layer_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."delete_community_layer"("p_layer_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_community_with_layers"("p_community_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."delete_community_with_layers"("p_community_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_pin_vote_summary"("target_pin_id" "uuid") RETURNS TABLE("upvotes" integer, "downvotes" integer, "user_vote" smallint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
declare
  acting_user uuid := public.request_user_id();
begin
  if not public.can_view_pin_for_votes(target_pin_id) then
    raise exception 'Pin not accessible for current user'
      using errcode = '42501';
  end if;

  return query
  select
    coalesce(sum(case when v.vote = 1 then 1 else 0 end), 0)::integer as upvotes,
    coalesce(sum(case when v.vote = -1 then 1 else 0 end), 0)::integer as downvotes,
    coalesce(
      max(case when acting_user is not null and v.user_id = acting_user then v.vote end),
      0
    )::smallint as user_vote
  from public.pin_votes v
  where v.pin_id = target_pin_id;
end;
$$;


ALTER FUNCTION "public"."get_pin_vote_summary"("target_pin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_community_lead_admin_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."guard_community_lead_admin_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_community_member_change_for_lead"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."handle_community_member_change_for_lead"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'user_' || substr(new.id::text, 1, 8)),
    coalesce(new.raw_user_meta_data->>'display_name', 'New User')
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_community_admin"("p_community_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."is_community_admin"("p_community_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_community_lead_admin"("p_community_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."is_community_lead_admin"("p_community_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_community_member"("p_community_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."is_community_member"("p_community_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_global_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.profiles p
    where p.id = public.request_user_id()
      and coalesce(p.is_admin, false) = true
  );
$$;


ALTER FUNCTION "public"."is_global_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."join_community"("p_community_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
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


ALTER FUNCTION "public"."join_community"("p_community_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pins_set_geometry_from_lat_lng"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if (new.geometry is null) and (new.geometry_type = 'point') then
    new.geometry = jsonb_build_object(
      'type', 'Point',
      'coordinates', jsonb_build_array(new.lng, new.lat)
    );
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."pins_set_geometry_from_lat_lng"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reassign_community_lead_admin"("p_community_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."reassign_community_lead_admin"("p_community_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rebuild_pin_layer_memberships"("p_pin_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
declare
  v_pin public.pins%rowtype;
  v_public_layer_id uuid;
  v_friends_layer_id uuid;
  v_private_layer_id uuid;
  v_base_layer_id uuid;
begin
  select *
    into v_pin
  from public.pins
  where id = p_pin_id;

  if not found then
    return;
  end if;

  -- Rebuild managed memberships from source-of-truth pin fields.
  delete from public.pin_layer_memberships
  where pin_id = p_pin_id
    and membership_role in ('author', 'base');

  -- Keep explicit target as an extra membership if present.
  if v_pin.explicit_layer_id is not null then
    insert into public.pin_layer_memberships (pin_id, layer_id, membership_role)
    values (p_pin_id, v_pin.explicit_layer_id, 'extra')
    on conflict (pin_id, layer_id) do update
      set membership_role = excluded.membership_role;
  end if;

  -- Keep author's user layer membership if known.
  if v_pin.author_layer_id is not null then
    insert into public.pin_layer_memberships (pin_id, layer_id, membership_role)
    values (p_pin_id, v_pin.author_layer_id, 'author')
    on conflict (pin_id, layer_id) do update
      set membership_role = excluded.membership_role;
  end if;

  -- Resolve canonical system layer ids.
  select l.id into v_public_layer_id
  from public.layers l
  where coalesce(l.owner_type, 'system') = 'system'
    and (
      lower(coalesce(l.kind, '')) = 'public'
      or lower(coalesce(l.name, '')) = 'public'
    )
  order by l.created_at asc, l.id asc
  limit 1;

  select l.id into v_friends_layer_id
  from public.layers l
  where coalesce(l.owner_type, 'system') = 'system'
    and (
      lower(coalesce(l.kind, '')) = 'friends'
      or lower(coalesce(l.name, '')) = 'friends'
    )
  order by l.created_at asc, l.id asc
  limit 1;

  select l.id into v_private_layer_id
  from public.layers l
  where coalesce(l.owner_type, 'system') = 'system'
    and (
      lower(coalesce(l.kind, '')) = 'private'
      or lower(coalesce(l.name, '')) = 'private'
    )
  order by l.created_at asc, l.id asc
  limit 1;

  -- Exactly one base membership per pin.
  v_base_layer_id := case v_pin.base_audience
    when 'public'::public.pin_base_audience then v_public_layer_id
    when 'friends'::public.pin_base_audience then v_friends_layer_id
    else v_private_layer_id
  end;

  if v_base_layer_id is not null then
    insert into public.pin_layer_memberships (pin_id, layer_id, membership_role)
    values (p_pin_id, v_base_layer_id, 'base')
    on conflict (pin_id, layer_id) do update
      set membership_role = excluded.membership_role;
  end if;
end;
$$;


ALTER FUNCTION "public"."rebuild_pin_layer_memberships"("p_pin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."send_community_message"("p_community_id" "uuid", "p_content" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
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


ALTER FUNCTION "public"."send_community_message"("p_community_id" "uuid", "p_content" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."send_direct_message"("p_receiver_id" "uuid", "p_content" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
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


ALTER FUNCTION "public"."send_direct_message"("p_receiver_id" "uuid", "p_content" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_pin_fields_before_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- Base audience fallback from legacy layer
  if new.base_audience is null then
    new.base_audience := (
      case lower(coalesce(new.layer, ''))
        when 'public' then 'public'
        when 'private' then 'private'
        else 'friends'
      end
    )::public.pin_base_audience;
  end if;

  -- Keep old pins.layer aligned for compatibility (legacy mirror)
  new.layer := new.base_audience::text;

  -- Best-effort author layer extraction (legacy support)
  if new.author_layer_id is null then
    new.author_layer_id := public.try_uuid(new.geometry->>'author_layer_id');
  end if;

  -- Best-effort explicit layer extraction ONLY IF explicit_layer_id is null
  -- (prevents geometry edits from changing visibility after initial capture)
  if new.explicit_layer_id is null then
    new.explicit_layer_id := public.try_uuid(new.geometry->>'layer_id');
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sync_pin_fields_before_write"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_pin_memberships_after_write"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.pin_layer_memberships WHERE pin_id = OLD.id;
    RETURN OLD;
  END IF;

  PERFORM public.rebuild_pin_layer_memberships(NEW.id);
  RETURN NEW;
END $$;


ALTER FUNCTION "public"."sync_pin_memberships_after_write"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."toggle_pin_vote"("target_pin_id" "uuid", "target_vote" smallint) RETURNS TABLE("upvotes" integer, "downvotes" integer, "user_vote" smallint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
declare
  acting_user uuid := public.request_user_id();
  pin_owner uuid;
  existing_vote smallint;
begin
  if acting_user is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  if target_vote not in (-1, 1) then
    raise exception 'Invalid vote value'
      using errcode = '22023';
  end if;

  select p.user_id
    into pin_owner
  from public.pins p
  where p.id = target_pin_id;

  if pin_owner is null then
    raise exception 'Pin not found'
      using errcode = 'P0002';
  end if;

  if pin_owner = acting_user then
    raise exception 'You cannot vote on your own pin'
      using errcode = '42501';
  end if;

  if not public.can_view_pin_for_votes(target_pin_id) then
    raise exception 'Pin not accessible for current user'
      using errcode = '42501';
  end if;

  select v.vote
    into existing_vote
  from public.pin_votes v
  where v.pin_id = target_pin_id
    and v.user_id = acting_user;

  if existing_vote = target_vote then
    delete from public.pin_votes
    where pin_id = target_pin_id
      and user_id = acting_user;
  else
    insert into public.pin_votes (pin_id, user_id, vote)
    values (target_pin_id, acting_user, target_vote)
    on conflict (pin_id, user_id)
    do update set
      vote = excluded.vote,
      updated_at = now();
  end if;

  return query
  select
    coalesce(sum(case when v.vote = 1 then 1 else 0 end), 0)::integer as upvotes,
    coalesce(sum(case when v.vote = -1 then 1 else 0 end), 0)::integer as downvotes,
    coalesce(
      max(case when v.user_id = acting_user then v.vote end),
      0
    )::smallint as user_vote
  from public.pin_votes v
  where v.pin_id = target_pin_id;
end;
$$;


ALTER FUNCTION "public"."toggle_pin_vote"("target_pin_id" "uuid", "target_vote" smallint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transfer_community_lead_admin"("p_community_id" "uuid", "p_target_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."transfer_community_lead_admin"("p_community_id" "uuid", "p_target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."try_uuid"("input" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
declare
  v uuid;
begin
  if input is null or btrim(input) = '' then
    return null;
  end if;

  begin
    v := input::uuid;
    return v;
  exception
    when others then
      return null;
  end;
end;
$$;


ALTER FUNCTION "public"."try_uuid"("input" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."update_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_layers_owner_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
BEGIN
  IF NEW.owner_type = 'system' THEN
    IF NEW.owner_id IS NOT NULL THEN
      RAISE EXCEPTION 'layers.owner_id must be NULL when owner_type=system';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.owner_type = 'community' THEN
    IF NOT EXISTS (SELECT 1 FROM public.communities c WHERE c.id = NEW.owner_id) THEN
      RAISE EXCEPTION 'layers.owner_id % not found in public.communities for owner_type=community', NEW.owner_id;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.owner_type = 'user' THEN
    IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.owner_id) THEN
      RAISE EXCEPTION 'layers.owner_id % not found in auth.users for owner_type=user', NEW.owner_id;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid owner_type: %', NEW.owner_type;
END;
$$;


ALTER FUNCTION "public"."validate_layers_owner_id"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."client_issue_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "category" "text" NOT NULL,
    "severity" "text" DEFAULT 'error'::"text" NOT NULL,
    "title" "text",
    "description" "text",
    "current_screen" "text",
    "app_version" "text",
    "app_build" "text",
    "platform" "text",
    "device_info" "text",
    "screenshot_path" "text",
    "stack" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_issue_reports_category_check" CHECK (("category" = ANY (ARRAY['bug_report'::"text", 'js_error'::"text", 'unhandled_rejection'::"text"]))),
    CONSTRAINT "client_issue_reports_severity_check" CHECK (("severity" = ANY (ARRAY['info'::"text", 'warning'::"text", 'error'::"text", 'fatal'::"text"])))
);


ALTER TABLE "public"."client_issue_reports" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."client_issue_reports_triage" WITH ("security_invoker"='true') AS
 SELECT "id",
    "created_at",
    "user_id",
    "category",
    "severity",
    "title",
    "description",
    "current_screen",
    "platform",
    "app_version",
    "app_build",
    "device_info",
    "screenshot_path",
    ("screenshot_path" IS NOT NULL) AS "has_screenshot",
    COALESCE(("metadata" ->> 'uploadError'::"text"), ''::"text") AS "screenshot_upload_error",
    "metadata"
   FROM "public"."client_issue_reports" "r";


ALTER VIEW "public"."client_issue_reports_triage" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."communities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "lead_admin_user_id" "uuid",
    "owner_user_id" "uuid"
);


ALTER TABLE "public"."communities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."community_layers" (
    "community_id" "uuid" NOT NULL,
    "layer_id" "uuid" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "removed_at" timestamp with time zone
);


ALTER TABLE "public"."community_layers" OWNER TO "postgres";


COMMENT ON COLUMN "public"."community_layers"."removed_at" IS 'to remove a community layer';



CREATE TABLE IF NOT EXISTS "public"."community_members" (
    "user_id" "uuid" NOT NULL,
    "community_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone,
    CONSTRAINT "community_members_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'member'::"text"]))),
    CONSTRAINT "community_members_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text"])))
);

ALTER TABLE ONLY "public"."community_members" REPLICA IDENTITY FULL;


ALTER TABLE "public"."community_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."community_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "community_id" "uuid" NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sender_name" "text"
);

ALTER TABLE ONLY "public"."community_messages" REPLICA IDENTITY FULL;


ALTER TABLE "public"."community_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."friends" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "friend_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "friends_check" CHECK (("user_id" <> "friend_id")),
    CONSTRAINT "friends_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'rejected'::"text"])))
);

ALTER TABLE ONLY "public"."friends" REPLICA IDENTITY FULL;


ALTER TABLE "public"."friends" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."layer_post_views" (
    "layer_id" "uuid" NOT NULL,
    "view_type" "text" DEFAULT 'default'::"text" NOT NULL,
    "view_config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "layer_post_views_view_type_check" CHECK (("view_type" = ANY (ARRAY['default'::"text", 'badge'::"text", 'highlight'::"text", 'metric'::"text", 'event'::"text", 'custom'::"text"])))
);


ALTER TABLE "public"."layer_post_views" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."layers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "kind" "text" NOT NULL,
    "name" "text" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "owner_type" "text" DEFAULT 'system'::"text" NOT NULL,
    "owner_id" "uuid",
    "is_public" boolean DEFAULT true NOT NULL,
    "description" "text",
    CONSTRAINT "layers_owner_consistency_check" CHECK (((("owner_type" = 'community'::"text") AND ("owner_id" IS NOT NULL)) OR (("owner_type" <> 'community'::"text") AND ("owner_id" IS NULL)))),
    CONSTRAINT "layers_owner_shape_check" CHECK (((("owner_type" = 'system'::"text") AND ("owner_id" IS NULL)) OR (("owner_type" = ANY (ARRAY['user'::"text", 'community'::"text"])) AND ("owner_id" IS NOT NULL)))),
    CONSTRAINT "layers_owner_type_check" CHECK (("owner_type" = ANY (ARRAY['system'::"text", 'community'::"text", 'user'::"text"])))
);


ALTER TABLE "public"."layers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "receiver_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "read" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "messages_check" CHECK (("sender_id" <> "receiver_id"))
);

ALTER TABLE ONLY "public"."messages" REPLICA IDENTITY FULL;


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."overlay_features" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "layer_id" "uuid" NOT NULL,
    "geom" "jsonb" NOT NULL,
    "props" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."overlay_features" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pin_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pin_id" "uuid" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "parent_comment_id" "uuid",
    "text" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid",
    "content" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pin_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pin_layer_memberships" (
    "pin_id" "uuid" NOT NULL,
    "layer_id" "uuid" NOT NULL,
    "membership_role" "text" DEFAULT 'extra'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pin_layer_memberships_membership_role_check" CHECK (("membership_role" = ANY (ARRAY['author'::"text", 'base'::"text", 'extra'::"text"])))
);


ALTER TABLE "public"."pin_layer_memberships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pin_votes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pin_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "vote" smallint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pin_votes_vote_check" CHECK (("vote" = ANY (ARRAY['-1'::integer, 1])))
);


ALTER TABLE "public"."pin_votes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pins" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" DEFAULT 'text'::"text" NOT NULL,
    "content" "text",
    "caption" "text",
    "media_url" "text",
    "media_type" "text",
    "lat" double precision NOT NULL,
    "lng" double precision NOT NULL,
    "layer" "text" DEFAULT 'public'::"text" NOT NULL,
    "author_name" "text",
    "author_username" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "geometry_type" "text" DEFAULT 'point'::"text" NOT NULL,
    "geometry" "jsonb",
    "posted_from_current_location" boolean DEFAULT false NOT NULL,
    "base_audience" "public"."pin_base_audience" DEFAULT 'public'::"public"."pin_base_audience" NOT NULL,
    "author_layer_id" "uuid",
    "explicit_layer_id" "uuid",
    CONSTRAINT "pins_geometry_type_check" CHECK (("geometry_type" = ANY (ARRAY['point'::"text", 'path'::"text", 'plane'::"text"]))),
    CONSTRAINT "pins_layer_check" CHECK (("layer" = ANY (ARRAY['public'::"text", 'friends'::"text", 'private'::"text", 'events'::"text"]))),
    CONSTRAINT "pins_type_check" CHECK (("type" = ANY (ARRAY['text'::"text", 'photo'::"text", 'video'::"text", 'media'::"text"])))
);


ALTER TABLE "public"."pins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "username" "text" NOT NULL,
    "display_name" "text",
    "avatar_url" "text",
    "bio" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_admin" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reporter_user_id" "uuid" NOT NULL,
    "pin_id" "uuid",
    "pin_comment_id" "uuid",
    "reason" "text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reports_one_target" CHECK (((("pin_id" IS NOT NULL) AND ("pin_comment_id" IS NULL)) OR (("pin_id" IS NULL) AND ("pin_comment_id" IS NOT NULL)))),
    CONSTRAINT "reports_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'reviewing'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_layer_prefs" (
    "user_id" "uuid" NOT NULL,
    "layer_id" "uuid" NOT NULL,
    "hidden" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sort_order" integer
);


ALTER TABLE "public"."user_layer_prefs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users_blocked" (
    "blocker_user" "uuid" NOT NULL,
    "blocked_user" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "users_blocked_not_self" CHECK (("blocker_user" <> "blocked_user"))
);


ALTER TABLE "public"."users_blocked" OWNER TO "postgres";


ALTER TABLE ONLY "public"."client_issue_reports"
    ADD CONSTRAINT "client_issue_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."communities"
    ADD CONSTRAINT "communities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."communities"
    ADD CONSTRAINT "communities_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."community_layers"
    ADD CONSTRAINT "community_layers_pkey" PRIMARY KEY ("community_id", "layer_id");



ALTER TABLE ONLY "public"."community_members"
    ADD CONSTRAINT "community_members_pkey" PRIMARY KEY ("user_id", "community_id");



ALTER TABLE ONLY "public"."community_messages"
    ADD CONSTRAINT "community_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."friends"
    ADD CONSTRAINT "friends_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."friends"
    ADD CONSTRAINT "friends_user_id_friend_id_key" UNIQUE ("user_id", "friend_id");



ALTER TABLE ONLY "public"."layer_post_views"
    ADD CONSTRAINT "layer_post_views_pkey" PRIMARY KEY ("layer_id");



ALTER TABLE ONLY "public"."layers"
    ADD CONSTRAINT "layers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."overlay_features"
    ADD CONSTRAINT "overlay_features_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pin_comments"
    ADD CONSTRAINT "pin_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pin_layer_memberships"
    ADD CONSTRAINT "pin_layer_memberships_pkey" PRIMARY KEY ("pin_id", "layer_id");



ALTER TABLE ONLY "public"."pin_votes"
    ADD CONSTRAINT "pin_votes_pin_id_user_id_key" UNIQUE ("pin_id", "user_id");



ALTER TABLE ONLY "public"."pin_votes"
    ADD CONSTRAINT "pin_votes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pins"
    ADD CONSTRAINT "pins_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_layer_prefs"
    ADD CONSTRAINT "user_layer_prefs_pkey" PRIMARY KEY ("user_id", "layer_id");



ALTER TABLE ONLY "public"."users_blocked"
    ADD CONSTRAINT "users_blocked_pkey" PRIMARY KEY ("blocker_user", "blocked_user");



CREATE INDEX "client_issue_reports_category_idx" ON "public"."client_issue_reports" USING "btree" ("category");



CREATE INDEX "client_issue_reports_created_at_idx" ON "public"."client_issue_reports" USING "btree" ("created_at" DESC);



CREATE INDEX "client_issue_reports_user_id_idx" ON "public"."client_issue_reports" USING "btree" ("user_id");



CREATE INDEX "communities_lead_admin_user_id_idx" ON "public"."communities" USING "btree" ("lead_admin_user_id");



CREATE INDEX "communities_owner_user_id_idx" ON "public"."communities" USING "btree" ("owner_user_id");



CREATE INDEX "community_layers_community_id_idx" ON "public"."community_layers" USING "btree" ("community_id");



CREATE INDEX "community_layers_layer_id_idx" ON "public"."community_layers" USING "btree" ("layer_id");



CREATE INDEX "community_members_community_id_idx" ON "public"."community_members" USING "btree" ("community_id");



CREATE INDEX "community_members_community_idx" ON "public"."community_members" USING "btree" ("community_id");



CREATE INDEX "community_members_status_idx" ON "public"."community_members" USING "btree" ("status");



CREATE INDEX "community_members_user_id_idx" ON "public"."community_members" USING "btree" ("user_id");



CREATE INDEX "community_members_user_idx" ON "public"."community_members" USING "btree" ("user_id");



CREATE INDEX "community_messages_community_id_idx" ON "public"."community_messages" USING "btree" ("community_id");



CREATE INDEX "community_messages_created_at_idx" ON "public"."community_messages" USING "btree" ("created_at" DESC);



CREATE INDEX "community_messages_sender_id_idx" ON "public"."community_messages" USING "btree" ("sender_id");



CREATE INDEX "friends_friend_id_idx" ON "public"."friends" USING "btree" ("friend_id");



CREATE INDEX "friends_status_idx" ON "public"."friends" USING "btree" ("status");



CREATE INDEX "friends_user_id_idx" ON "public"."friends" USING "btree" ("user_id");



CREATE INDEX "layer_post_views_view_type_idx" ON "public"."layer_post_views" USING "btree" ("view_type");



CREATE INDEX "messages_conversation_idx" ON "public"."messages" USING "btree" ("sender_id", "receiver_id", "created_at" DESC);



CREATE INDEX "messages_created_at_idx" ON "public"."messages" USING "btree" ("created_at" DESC);



CREATE INDEX "messages_receiver_id_idx" ON "public"."messages" USING "btree" ("receiver_id");



CREATE INDEX "messages_sender_id_idx" ON "public"."messages" USING "btree" ("sender_id");



CREATE UNIQUE INDEX "one_base_layer_per_pin" ON "public"."pin_layer_memberships" USING "btree" ("pin_id") WHERE ("membership_role" = 'base'::"text");



CREATE UNIQUE INDEX "one_pin_per_cross_post_group" ON "public"."pins" USING "btree" ((("geometry" ->> 'cross_post_group_id'::"text"))) WHERE (("geometry" ->> 'cross_post_group_id'::"text") IS NOT NULL);



CREATE INDEX "overlay_features_layer_id_idx" ON "public"."overlay_features" USING "btree" ("layer_id");



CREATE INDEX "pin_comments_author_idx" ON "public"."pin_comments" USING "btree" ("author_id");



CREATE INDEX "pin_comments_parent_comment_id_idx" ON "public"."pin_comments" USING "btree" ("parent_comment_id");



CREATE INDEX "pin_comments_parent_idx" ON "public"."pin_comments" USING "btree" ("parent_comment_id");



CREATE INDEX "pin_comments_pin_created_idx" ON "public"."pin_comments" USING "btree" ("pin_id", "created_at");



CREATE INDEX "pin_comments_pin_idx" ON "public"."pin_comments" USING "btree" ("pin_id");



CREATE INDEX "pin_comments_user_created_idx" ON "public"."pin_comments" USING "btree" ("user_id", "created_at");



CREATE INDEX "pin_layer_memberships_layer_pin_idx" ON "public"."pin_layer_memberships" USING "btree" ("layer_id", "pin_id");



CREATE UNIQUE INDEX "pin_layer_memberships_one_base_per_pin_idx" ON "public"."pin_layer_memberships" USING "btree" ("pin_id") WHERE ("membership_role" = 'base'::"text");



CREATE INDEX "pin_layer_memberships_pin_idx" ON "public"."pin_layer_memberships" USING "btree" ("pin_id");



CREATE INDEX "pin_votes_pin_id_idx" ON "public"."pin_votes" USING "btree" ("pin_id");



CREATE INDEX "pin_votes_user_id_idx" ON "public"."pin_votes" USING "btree" ("user_id");



CREATE INDEX "pins_author_layer_id_idx" ON "public"."pins" USING "btree" ("author_layer_id");



CREATE INDEX "pins_base_audience_idx" ON "public"."pins" USING "btree" ("base_audience");



CREATE INDEX "pins_created_at_idx" ON "public"."pins" USING "btree" ("created_at" DESC);



CREATE INDEX "pins_explicit_layer_id_idx" ON "public"."pins" USING "btree" ("explicit_layer_id");



CREATE INDEX "pins_geometry_gin_idx" ON "public"."pins" USING "gin" ("geometry");



CREATE INDEX "pins_geometry_type_idx" ON "public"."pins" USING "btree" ("geometry_type");



CREATE INDEX "pins_layer_idx" ON "public"."pins" USING "btree" ("layer");



CREATE INDEX "pins_location_idx" ON "public"."pins" USING "btree" ("lat", "lng");



CREATE INDEX "pins_user_id_idx" ON "public"."pins" USING "btree" ("user_id");



CREATE INDEX "profiles_username_idx" ON "public"."profiles" USING "btree" ("username");



CREATE INDEX "reports_pin_comment_idx" ON "public"."reports" USING "btree" ("pin_comment_id");



CREATE INDEX "reports_pin_idx" ON "public"."reports" USING "btree" ("pin_id");



CREATE INDEX "reports_reporter_idx" ON "public"."reports" USING "btree" ("reporter_user_id");



CREATE INDEX "reports_status_idx" ON "public"."reports" USING "btree" ("status");



CREATE INDEX "user_layer_prefs_layer_id_idx" ON "public"."user_layer_prefs" USING "btree" ("layer_id");



CREATE INDEX "user_layer_prefs_user_id_idx" ON "public"."user_layer_prefs" USING "btree" ("user_id");



CREATE INDEX "user_layer_prefs_user_sort_order_idx" ON "public"."user_layer_prefs" USING "btree" ("user_id", "sort_order", "layer_id");



CREATE INDEX "users_blocked_blocked_idx" ON "public"."users_blocked" USING "btree" ("blocked_user");



CREATE INDEX "users_blocked_blocker_idx" ON "public"."users_blocked" USING "btree" ("blocker_user");



CREATE OR REPLACE TRIGGER "community_lead_admin_guard" BEFORE UPDATE ON "public"."communities" FOR EACH ROW EXECUTE FUNCTION "public"."guard_community_lead_admin_update"();



CREATE OR REPLACE TRIGGER "community_members_reassign_lead" AFTER INSERT OR DELETE OR UPDATE ON "public"."community_members" FOR EACH ROW EXECUTE FUNCTION "public"."handle_community_member_change_for_lead"();



CREATE OR REPLACE TRIGGER "community_members_updated_at" BEFORE UPDATE ON "public"."community_members" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "friends_updated_at" BEFORE UPDATE ON "public"."friends" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "messages_updated_at" BEFORE UPDATE ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "pin_comments_updated_at" BEFORE UPDATE ON "public"."pin_comments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "pin_votes_updated_at" BEFORE UPDATE ON "public"."pin_votes" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "pins_set_geometry_from_lat_lng" BEFORE INSERT OR UPDATE ON "public"."pins" FOR EACH ROW EXECUTE FUNCTION "public"."pins_set_geometry_from_lat_lng"();



CREATE OR REPLACE TRIGGER "pins_sync_fields_before_write" BEFORE INSERT OR UPDATE OF "layer", "base_audience", "author_layer_id", "explicit_layer_id", "geometry" ON "public"."pins" FOR EACH ROW EXECUTE FUNCTION "public"."sync_pin_fields_before_write"();



CREATE OR REPLACE TRIGGER "pins_sync_memberships_after_write" AFTER INSERT OR UPDATE OF "layer", "base_audience", "author_layer_id", "explicit_layer_id" ON "public"."pins" FOR EACH ROW EXECUTE FUNCTION "public"."sync_pin_memberships_after_write"();



CREATE OR REPLACE TRIGGER "pins_updated_at" BEFORE UPDATE ON "public"."pins" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "sync_pin_memberships_after_write" AFTER INSERT OR DELETE OR UPDATE OF "base_audience", "author_layer_id", "explicit_layer_id" ON "public"."pins" FOR EACH ROW EXECUTE FUNCTION "public"."sync_pin_memberships_after_write"();



CREATE OR REPLACE TRIGGER "trg_user_layer_prefs_updated_at" BEFORE UPDATE ON "public"."user_layer_prefs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_validate_layers_owner_id" BEFORE INSERT OR UPDATE OF "owner_type", "owner_id" ON "public"."layers" FOR EACH ROW EXECUTE FUNCTION "public"."validate_layers_owner_id"();



ALTER TABLE ONLY "public"."client_issue_reports"
    ADD CONSTRAINT "client_issue_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."communities"
    ADD CONSTRAINT "communities_lead_admin_user_id_fkey" FOREIGN KEY ("lead_admin_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."communities"
    ADD CONSTRAINT "communities_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."community_layers"
    ADD CONSTRAINT "community_layers_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."community_layers"
    ADD CONSTRAINT "community_layers_layer_id_fkey" FOREIGN KEY ("layer_id") REFERENCES "public"."layers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."community_members"
    ADD CONSTRAINT "community_members_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."community_members"
    ADD CONSTRAINT "community_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."community_messages"
    ADD CONSTRAINT "community_messages_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."community_messages"
    ADD CONSTRAINT "community_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."friends"
    ADD CONSTRAINT "friends_friend_id_fkey" FOREIGN KEY ("friend_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."friends"
    ADD CONSTRAINT "friends_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."layer_post_views"
    ADD CONSTRAINT "layer_post_views_layer_id_fkey" FOREIGN KEY ("layer_id") REFERENCES "public"."layers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."layers"
    ADD CONSTRAINT "layers_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."communities"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."overlay_features"
    ADD CONSTRAINT "overlay_features_layer_id_fkey" FOREIGN KEY ("layer_id") REFERENCES "public"."layers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pin_comments"
    ADD CONSTRAINT "pin_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pin_comments"
    ADD CONSTRAINT "pin_comments_parent_comment_id_fkey" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."pin_comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pin_comments"
    ADD CONSTRAINT "pin_comments_pin_id_fkey" FOREIGN KEY ("pin_id") REFERENCES "public"."pins"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pin_comments"
    ADD CONSTRAINT "pin_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pin_layer_memberships"
    ADD CONSTRAINT "pin_layer_memberships_layer_id_fkey" FOREIGN KEY ("layer_id") REFERENCES "public"."layers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pin_layer_memberships"
    ADD CONSTRAINT "pin_layer_memberships_pin_id_fkey" FOREIGN KEY ("pin_id") REFERENCES "public"."pins"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pin_votes"
    ADD CONSTRAINT "pin_votes_pin_id_fkey" FOREIGN KEY ("pin_id") REFERENCES "public"."pins"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pin_votes"
    ADD CONSTRAINT "pin_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pins"
    ADD CONSTRAINT "pins_author_layer_id_fkey" FOREIGN KEY ("author_layer_id") REFERENCES "public"."layers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pins"
    ADD CONSTRAINT "pins_explicit_layer_id_fkey" FOREIGN KEY ("explicit_layer_id") REFERENCES "public"."layers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pins"
    ADD CONSTRAINT "pins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_pin_comment_id_fkey" FOREIGN KEY ("pin_comment_id") REFERENCES "public"."pin_comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_pin_id_fkey" FOREIGN KEY ("pin_id") REFERENCES "public"."pins"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_reporter_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_layer_prefs"
    ADD CONSTRAINT "user_layer_prefs_layer_id_fkey" FOREIGN KEY ("layer_id") REFERENCES "public"."layers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_layer_prefs"
    ADD CONSTRAINT "user_layer_prefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users_blocked"
    ADD CONSTRAINT "users_blocked_blocked_user_fkey" FOREIGN KEY ("blocked_user") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users_blocked"
    ADD CONSTRAINT "users_blocked_blocker_user_fkey" FOREIGN KEY ("blocker_user") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Admins can delete any pin" ON "public"."pins" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true)))));



CREATE POLICY "Admins can delete pins" ON "public"."pins" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND (COALESCE("p"."is_admin", false) = true)))));



CREATE POLICY "Authenticated users can create communities" ON "public"."communities" FOR INSERT WITH CHECK (("public"."request_user_id"() IS NOT NULL));



CREATE POLICY "Authenticated users can create user layers" ON "public"."layers" FOR INSERT WITH CHECK ((("auth"."uid"() IS NOT NULL) AND ("owner_type" = 'user'::"text") AND ("owner_id" IS NULL)));



CREATE POLICY "Comment authors or pin owners can delete comments" ON "public"."pin_comments" FOR DELETE USING ((("public"."request_user_id"() IS NOT NULL) AND (("user_id" = "public"."request_user_id"()) OR (EXISTS ( SELECT 1
   FROM "public"."pins" "p"
  WHERE (("p"."id" = "pin_comments"."pin_id") AND ("p"."user_id" = "public"."request_user_id"())))))));



CREATE POLICY "Communities are viewable by everyone" ON "public"."communities" FOR SELECT USING (true);



CREATE POLICY "Community admins can create community layers" ON "public"."layers" FOR INSERT WITH CHECK ((("auth"."uid"() IS NOT NULL) AND ("owner_type" = 'community'::"text") AND ("owner_id" IS NOT NULL) AND "public"."is_community_admin"("owner_id")));



CREATE POLICY "Community admins can delete community layers" ON "public"."layers" FOR DELETE USING ((("owner_type" = 'community'::"text") AND ("owner_id" IS NOT NULL) AND "public"."is_community_admin"("owner_id")));



CREATE POLICY "Community admins can manage community layers" ON "public"."community_layers" USING ("public"."is_community_admin"("community_id")) WITH CHECK ("public"."is_community_admin"("community_id"));



CREATE POLICY "Community admins can update communities" ON "public"."communities" FOR UPDATE USING ("public"."is_community_admin"("id")) WITH CHECK ("public"."is_community_admin"("id"));



CREATE POLICY "Community admins can update community layers" ON "public"."layers" FOR UPDATE USING ((("owner_type" = 'community'::"text") AND ("owner_id" IS NOT NULL) AND "public"."is_community_admin"("owner_id"))) WITH CHECK ((("owner_type" = 'community'::"text") AND ("owner_id" IS NOT NULL) AND "public"."is_community_admin"("owner_id")));



CREATE POLICY "Community admins can update memberships" ON "public"."community_members" FOR UPDATE USING ("public"."is_community_admin"("community_id")) WITH CHECK ("public"."is_community_admin"("community_id"));



CREATE POLICY "Community layers are viewable by everyone" ON "public"."community_layers" FOR SELECT USING (true);



CREATE POLICY "Community lead admins can delete communities" ON "public"."communities" FOR DELETE USING ("public"."is_community_lead_admin"("id"));



CREATE POLICY "Community members can send group chat messages" ON "public"."community_messages" FOR INSERT WITH CHECK ((("public"."request_user_id"() = "sender_id") AND "public"."is_community_member"("community_id")));



CREATE POLICY "Community members can view group chat" ON "public"."community_messages" FOR SELECT USING ("public"."is_community_member"("community_id"));



CREATE POLICY "Friends pins are viewable by friends" ON "public"."pins" FOR SELECT USING ((("layer" = 'friends'::"text") AND (("auth"."uid"() = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."friends"
  WHERE (("friends"."status" = 'accepted'::"text") AND ((("friends"."user_id" = "auth"."uid"()) AND ("friends"."friend_id" = "pins"."user_id")) OR (("friends"."friend_id" = "auth"."uid"()) AND ("friends"."user_id" = "pins"."user_id")))))))));



CREATE POLICY "Global admins can delete communities" ON "public"."communities" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."is_admin" = true)))));



CREATE POLICY "Global admins can force join communities" ON "public"."community_members" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."is_admin" = true)))) AND ("role" = ANY (ARRAY['member'::"text", 'admin'::"text", 'owner'::"text"])) AND ("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'active'::"text"]))));



CREATE POLICY "Layer post views are deletable by layer admins" ON "public"."layer_post_views" FOR DELETE USING ("public"."can_actor_manage_layer_presentation"("layer_id", "public"."request_user_id"()));



CREATE POLICY "Layer post views are editable by layer admins" ON "public"."layer_post_views" FOR INSERT WITH CHECK ("public"."can_actor_manage_layer_presentation"("layer_id", "public"."request_user_id"()));



CREATE POLICY "Layer post views are readable by layer viewers" ON "public"."layer_post_views" FOR SELECT USING ("public"."can_actor_view_layer"("layer_id", "public"."request_user_id"()));



CREATE POLICY "Layer post views are updatable by layer admins" ON "public"."layer_post_views" FOR UPDATE USING ("public"."can_actor_manage_layer_presentation"("layer_id", "public"."request_user_id"())) WITH CHECK ("public"."can_actor_manage_layer_presentation"("layer_id", "public"."request_user_id"()));



CREATE POLICY "Layers are viewable by everyone" ON "public"."layers" FOR SELECT USING (true);



CREATE POLICY "Members can view their community membership records" ON "public"."community_members" FOR SELECT USING ((("public"."request_user_id"() = "user_id") OR "public"."is_community_member"("community_id")));



CREATE POLICY "Pin owners can attach memberships" ON "public"."pin_layer_memberships" FOR INSERT WITH CHECK ("public"."can_actor_attach_layer_to_pin"("pin_id", "layer_id", "public"."request_user_id"()));



CREATE POLICY "Pin owners can remove memberships" ON "public"."pin_layer_memberships" FOR DELETE USING ("public"."can_actor_attach_layer_to_pin"("pin_id", "layer_id", "public"."request_user_id"()));



CREATE POLICY "Pins are viewable by accessible memberships" ON "public"."pins" FOR SELECT USING ("public"."can_actor_view_pin"("id", "public"."request_user_id"()));



CREATE POLICY "Pins are visible via layers, authorship, or audience" ON "public"."pins" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM ("public"."pin_layer_memberships" "plm"
     JOIN "public"."user_layer_prefs" "ulp" ON ((("ulp"."layer_id" = "plm"."layer_id") AND ("ulp"."user_id" = "auth"."uid"()) AND ("ulp"."hidden" = false))))
  WHERE ("plm"."pin_id" = "pins"."id"))) OR (("base_audience" = 'friends'::"public"."pin_base_audience") AND (EXISTS ( SELECT 1
   FROM "public"."friends" "f"
  WHERE (("f"."status" = 'accepted'::"text") AND ((("f"."user_id" = "auth"."uid"()) AND ("f"."friend_id" = "pins"."user_id")) OR (("f"."friend_id" = "auth"."uid"()) AND ("f"."user_id" = "pins"."user_id"))))))) OR ("base_audience" = 'public'::"public"."pin_base_audience")));



CREATE POLICY "Private pins are viewable by owner" ON "public"."pins" FOR SELECT USING ((("layer" = 'private'::"text") AND ("public"."request_user_id"() = "user_id")));



CREATE POLICY "Profiles are viewable by everyone" ON "public"."profiles" FOR SELECT USING (true);



CREATE POLICY "Public pins are viewable by everyone" ON "public"."pins" FOR SELECT USING (("layer" = 'public'::"text"));



CREATE POLICY "Senders and admins can delete group chat messages" ON "public"."community_messages" FOR DELETE USING ((("public"."request_user_id"() = "sender_id") OR "public"."is_community_admin"("community_id")));



CREATE POLICY "Users can add comments to visible pins" ON "public"."pin_comments" FOR INSERT WITH CHECK ((("public"."request_user_id"() IS NOT NULL) AND ("public"."request_user_id"() = "user_id") AND "public"."can_view_pin_for_votes"("pin_id") AND (("parent_comment_id" IS NULL) OR (EXISTS ( SELECT 1
   FROM "public"."pin_comments" "parent"
  WHERE (("parent"."id" = "pin_comments"."parent_comment_id") AND ("parent"."pin_id" = "pin_comments"."pin_id")))))));



CREATE POLICY "Users can delete their friendships" ON "public"."friends" FOR DELETE USING ((("public"."request_user_id"() = "user_id") OR ("public"."request_user_id"() = "friend_id")));



CREATE POLICY "Users can delete their own layer prefs" ON "public"."user_layer_prefs" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own messages" ON "public"."messages" FOR DELETE USING (("public"."request_user_id"() = "sender_id"));



CREATE POLICY "Users can delete their own pin comments" ON "public"."pin_comments" FOR DELETE USING (("public"."request_user_id"() = "user_id"));



CREATE POLICY "Users can delete their own pin votes" ON "public"."pin_votes" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own pins" ON "public"."pins" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert client issue reports" ON "public"."client_issue_reports" FOR INSERT WITH CHECK (((("public"."request_user_id"() IS NULL) AND ("user_id" IS NULL)) OR ("public"."request_user_id"() = "user_id")));



CREATE POLICY "Users can insert comments for visible pins" ON "public"."pin_comments" FOR INSERT WITH CHECK ((("public"."request_user_id"() = "user_id") AND "public"."can_comment_on_pin"("pin_id")));



CREATE POLICY "Users can insert their own layer prefs" ON "public"."user_layer_prefs" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own pin votes" ON "public"."pin_votes" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") AND "public"."can_vote_on_pin"("pin_id")));



CREATE POLICY "Users can insert their own pins" ON "public"."pins" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own profile" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can leave and admins can remove members" ON "public"."community_members" FOR DELETE USING ((("public"."request_user_id"() = "user_id") OR "public"."is_community_admin"("community_id")));



CREATE POLICY "Users can request to join communities" ON "public"."community_members" FOR INSERT WITH CHECK ((("public"."request_user_id"() = "user_id") AND ((("status" = 'accepted'::"text") AND ("role" = 'member'::"text")) OR (("status" = 'pending'::"text") AND ("role" = 'member'::"text")) OR (("status" = 'accepted'::"text") AND ("role" = 'admin'::"text") AND ("public"."community_member_count"("community_id") = 0)))));



CREATE POLICY "Users can send friend requests" ON "public"."friends" FOR INSERT WITH CHECK (("public"."request_user_id"() = "user_id"));



CREATE POLICY "Users can send messages to friends" ON "public"."messages" FOR INSERT WITH CHECK ((("public"."request_user_id"() = "sender_id") AND (EXISTS ( SELECT 1
   FROM "public"."friends" "f"
  WHERE (("f"."status" = ANY (ARRAY['accepted'::"text", 'active'::"text"])) AND ((("f"."user_id" = "public"."request_user_id"()) AND ("f"."friend_id" = "messages"."receiver_id")) OR (("f"."friend_id" = "public"."request_user_id"()) AND ("f"."user_id" = "messages"."receiver_id"))))))));



CREATE POLICY "Users can update messages they received" ON "public"."messages" FOR UPDATE USING (("public"."request_user_id"() = "receiver_id")) WITH CHECK (("public"."request_user_id"() = "receiver_id"));



CREATE POLICY "Users can update their friendships" ON "public"."friends" FOR UPDATE USING ((("public"."request_user_id"() = "user_id") OR ("public"."request_user_id"() = "friend_id"))) WITH CHECK ((("public"."request_user_id"() = "user_id") OR ("public"."request_user_id"() = "friend_id")));



CREATE POLICY "Users can update their own layer prefs" ON "public"."user_layer_prefs" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own pin comments" ON "public"."pin_comments" FOR UPDATE USING (("public"."request_user_id"() = "user_id")) WITH CHECK (("public"."request_user_id"() = "user_id"));



CREATE POLICY "Users can update their own pin votes" ON "public"."pin_votes" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK ((("auth"."uid"() = "user_id") AND "public"."can_vote_on_pin"("pin_id")));



CREATE POLICY "Users can update their own pins" ON "public"."pins" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can view comments for visible pins" ON "public"."pin_comments" FOR SELECT USING ("public"."can_view_pin_for_votes"("pin_id"));



CREATE POLICY "Users can view their own client issue reports" ON "public"."client_issue_reports" FOR SELECT USING ((("public"."request_user_id"() IS NOT NULL) AND ("user_id" = "public"."request_user_id"())));



CREATE POLICY "Users can view their own friendships" ON "public"."friends" FOR SELECT USING ((("public"."request_user_id"() = "user_id") OR ("public"."request_user_id"() = "friend_id")));



CREATE POLICY "Users can view their own layer prefs" ON "public"."user_layer_prefs" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own messages" ON "public"."messages" FOR SELECT USING ((("public"."request_user_id"() = "sender_id") OR ("public"."request_user_id"() = "receiver_id")));



CREATE POLICY "Users can view votes for visible pins" ON "public"."pin_votes" FOR SELECT USING ("public"."can_view_pin_for_votes"("pin_id"));



CREATE POLICY "Visible pin memberships are readable" ON "public"."pin_layer_memberships" FOR SELECT USING ("public"."can_actor_view_pin"("pin_id", "public"."request_user_id"()));



ALTER TABLE "public"."client_issue_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."communities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."community_layers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."community_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."community_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "delete own layer prefs" ON "public"."user_layer_prefs" FOR DELETE USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."friends" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "insert own layer prefs" ON "public"."user_layer_prefs" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."layer_post_views" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."layers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pin_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pin_layer_memberships" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pin_votes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pins" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "read own layer prefs" ON "public"."user_layer_prefs" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "update own layer prefs" ON "public"."user_layer_prefs" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."user_layer_prefs" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."request_user_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_user_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."request_user_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."request_user_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_actor_attach_layer_to_pin"("target_pin_id" "uuid", "target_layer_id" "uuid", "actor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_actor_attach_layer_to_pin"("target_pin_id" "uuid", "target_layer_id" "uuid", "actor_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_actor_attach_layer_to_pin"("target_pin_id" "uuid", "target_layer_id" "uuid", "actor_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_actor_attach_layer_to_pin"("target_pin_id" "uuid", "target_layer_id" "uuid", "actor_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_actor_manage_layer_presentation"("target_layer_id" "uuid", "actor_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_actor_manage_layer_presentation"("target_layer_id" "uuid", "actor_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_actor_manage_layer_presentation"("target_layer_id" "uuid", "actor_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_actor_view_layer"("target_layer_id" "uuid", "actor_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_actor_view_layer"("target_layer_id" "uuid", "actor_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_actor_view_layer"("target_layer_id" "uuid", "actor_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_actor_view_pin"("target_pin_id" "uuid", "actor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_actor_view_pin"("target_pin_id" "uuid", "actor_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_actor_view_pin"("target_pin_id" "uuid", "actor_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_actor_view_pin"("target_pin_id" "uuid", "actor_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_comment_on_pin"("target_pin_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_comment_on_pin"("target_pin_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_comment_on_pin"("target_pin_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_comment_on_pin"("target_pin_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_view_pin_for_votes"("target_pin_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_view_pin_for_votes"("target_pin_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_view_pin_for_votes"("target_pin_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_view_pin_for_votes"("target_pin_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_vote_on_pin"("target_pin_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_vote_on_pin"("target_pin_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_vote_on_pin"("target_pin_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_vote_on_pin"("target_pin_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."community_member_count"("p_community_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."community_member_count"("p_community_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."community_member_count"("p_community_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."community_member_interaction_score"("p_community_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."community_member_interaction_score"("p_community_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."community_member_interaction_score"("p_community_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."community_member_interaction_score"("p_community_id" "uuid", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_community_layer"("p_community_id" "uuid", "p_name" "text", "p_kind" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_community_layer"("p_community_id" "uuid", "p_name" "text", "p_kind" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_community_layer"("p_community_id" "uuid", "p_name" "text", "p_kind" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_community_layer"("p_community_id" "uuid", "p_name" "text", "p_kind" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."debug_auth_context"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_community_layer"("p_layer_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_community_layer"("p_layer_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_community_layer"("p_layer_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_community_layer"("p_layer_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_community_with_layers"("p_community_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_community_with_layers"("p_community_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_community_with_layers"("p_community_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_community_with_layers"("p_community_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_pin_vote_summary"("target_pin_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_pin_vote_summary"("target_pin_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_pin_vote_summary"("target_pin_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_pin_vote_summary"("target_pin_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."guard_community_lead_admin_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_community_lead_admin_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_community_lead_admin_update"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_community_member_change_for_lead"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_community_member_change_for_lead"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_community_member_change_for_lead"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_community_member_change_for_lead"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_community_admin"("p_community_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_community_admin"("p_community_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_community_admin"("p_community_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_community_lead_admin"("p_community_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_community_lead_admin"("p_community_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_community_lead_admin"("p_community_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_community_lead_admin"("p_community_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_community_member"("p_community_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_community_member"("p_community_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_community_member"("p_community_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_global_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_global_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_global_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_global_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."join_community"("p_community_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."join_community"("p_community_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."join_community"("p_community_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."pins_set_geometry_from_lat_lng"() TO "anon";
GRANT ALL ON FUNCTION "public"."pins_set_geometry_from_lat_lng"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."pins_set_geometry_from_lat_lng"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."reassign_community_lead_admin"("p_community_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reassign_community_lead_admin"("p_community_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."reassign_community_lead_admin"("p_community_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reassign_community_lead_admin"("p_community_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rebuild_pin_layer_memberships"("p_pin_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rebuild_pin_layer_memberships"("p_pin_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rebuild_pin_layer_memberships"("p_pin_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."send_community_message"("p_community_id" "uuid", "p_content" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."send_community_message"("p_community_id" "uuid", "p_content" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."send_community_message"("p_community_id" "uuid", "p_content" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."send_direct_message"("p_receiver_id" "uuid", "p_content" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."send_direct_message"("p_receiver_id" "uuid", "p_content" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."send_direct_message"("p_receiver_id" "uuid", "p_content" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_pin_fields_before_write"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_pin_fields_before_write"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_pin_fields_before_write"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_pin_memberships_after_write"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_pin_memberships_after_write"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_pin_memberships_after_write"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."toggle_pin_vote"("target_pin_id" "uuid", "target_vote" smallint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."toggle_pin_vote"("target_pin_id" "uuid", "target_vote" smallint) TO "anon";
GRANT ALL ON FUNCTION "public"."toggle_pin_vote"("target_pin_id" "uuid", "target_vote" smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."toggle_pin_vote"("target_pin_id" "uuid", "target_vote" smallint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."transfer_community_lead_admin"("p_community_id" "uuid", "p_target_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transfer_community_lead_admin"("p_community_id" "uuid", "p_target_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."transfer_community_lead_admin"("p_community_id" "uuid", "p_target_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."transfer_community_lead_admin"("p_community_id" "uuid", "p_target_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."try_uuid"("input" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."try_uuid"("input" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."try_uuid"("input" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_layers_owner_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_layers_owner_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_layers_owner_id"() TO "service_role";



GRANT ALL ON TABLE "public"."client_issue_reports" TO "anon";
GRANT ALL ON TABLE "public"."client_issue_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."client_issue_reports" TO "service_role";



GRANT ALL ON TABLE "public"."client_issue_reports_triage" TO "anon";
GRANT ALL ON TABLE "public"."client_issue_reports_triage" TO "authenticated";
GRANT ALL ON TABLE "public"."client_issue_reports_triage" TO "service_role";



GRANT ALL ON TABLE "public"."communities" TO "anon";
GRANT ALL ON TABLE "public"."communities" TO "authenticated";
GRANT ALL ON TABLE "public"."communities" TO "service_role";



GRANT ALL ON TABLE "public"."community_layers" TO "anon";
GRANT ALL ON TABLE "public"."community_layers" TO "authenticated";
GRANT ALL ON TABLE "public"."community_layers" TO "service_role";



GRANT ALL ON TABLE "public"."community_members" TO "anon";
GRANT ALL ON TABLE "public"."community_members" TO "authenticated";
GRANT ALL ON TABLE "public"."community_members" TO "service_role";



GRANT ALL ON TABLE "public"."community_messages" TO "anon";
GRANT ALL ON TABLE "public"."community_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."community_messages" TO "service_role";



GRANT ALL ON TABLE "public"."friends" TO "anon";
GRANT ALL ON TABLE "public"."friends" TO "authenticated";
GRANT ALL ON TABLE "public"."friends" TO "service_role";



GRANT ALL ON TABLE "public"."layer_post_views" TO "anon";
GRANT ALL ON TABLE "public"."layer_post_views" TO "authenticated";
GRANT ALL ON TABLE "public"."layer_post_views" TO "service_role";



GRANT ALL ON TABLE "public"."layers" TO "anon";
GRANT ALL ON TABLE "public"."layers" TO "authenticated";
GRANT ALL ON TABLE "public"."layers" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."overlay_features" TO "anon";
GRANT ALL ON TABLE "public"."overlay_features" TO "authenticated";
GRANT ALL ON TABLE "public"."overlay_features" TO "service_role";



GRANT ALL ON TABLE "public"."pin_comments" TO "anon";
GRANT ALL ON TABLE "public"."pin_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."pin_comments" TO "service_role";



GRANT ALL ON TABLE "public"."pin_layer_memberships" TO "anon";
GRANT ALL ON TABLE "public"."pin_layer_memberships" TO "authenticated";
GRANT ALL ON TABLE "public"."pin_layer_memberships" TO "service_role";



GRANT ALL ON TABLE "public"."pin_votes" TO "anon";
GRANT ALL ON TABLE "public"."pin_votes" TO "authenticated";
GRANT ALL ON TABLE "public"."pin_votes" TO "service_role";



GRANT ALL ON TABLE "public"."pins" TO "anon";
GRANT ALL ON TABLE "public"."pins" TO "authenticated";
GRANT ALL ON TABLE "public"."pins" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."reports" TO "anon";
GRANT ALL ON TABLE "public"."reports" TO "authenticated";
GRANT ALL ON TABLE "public"."reports" TO "service_role";



GRANT ALL ON TABLE "public"."user_layer_prefs" TO "anon";
GRANT ALL ON TABLE "public"."user_layer_prefs" TO "authenticated";
GRANT ALL ON TABLE "public"."user_layer_prefs" TO "service_role";



GRANT ALL ON TABLE "public"."users_blocked" TO "anon";
GRANT ALL ON TABLE "public"."users_blocked" TO "authenticated";
GRANT ALL ON TABLE "public"."users_blocked" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







