-- ============================================================================
-- Auth claim fallback for votes + friends
-- Mitigates environments where auth.uid() is null but JWT still contains
-- usable user identity claims.
-- ============================================================================

create or replace function public.request_user_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  resolved uuid;
  claim_user_id text;
  claim_email text;
begin
  resolved := auth.uid();
  if resolved is not null then
    return resolved;
  end if;

  claim_user_id := coalesce(
    nullif(auth.jwt() ->> 'user_id', ''),
    nullif(auth.jwt() ->> 'id', '')
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
revoke all on function public.request_user_id() from public;
grant execute on function public.request_user_id() to anon;
grant execute on function public.request_user_id() to authenticated;
grant execute on function public.request_user_id() to service_role;
create or replace function public.can_view_pin_for_votes(target_pin_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
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
create or replace function public.can_vote_on_pin(target_pin_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
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
create or replace function public.get_pin_vote_summary(target_pin_id uuid)
returns table (
  upvotes integer,
  downvotes integer,
  user_vote smallint
)
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
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
create or replace function public.toggle_pin_vote(
  target_pin_id uuid,
  target_vote smallint
)
returns table (
  upvotes integer,
  downvotes integer,
  user_vote smallint
)
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
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
drop policy if exists "Users can view their own friendships" on public.friends;
create policy "Users can view their own friendships"
  on public.friends
  for select
  using (
    public.request_user_id() = user_id
    or public.request_user_id() = friend_id
  );
drop policy if exists "Users can send friend requests" on public.friends;
create policy "Users can send friend requests"
  on public.friends
  for insert
  with check (public.request_user_id() = user_id);
drop policy if exists "Users can update their friendships" on public.friends;
create policy "Users can update their friendships"
  on public.friends
  for update
  using (
    public.request_user_id() = user_id
    or public.request_user_id() = friend_id
  )
  with check (
    public.request_user_id() = user_id
    or public.request_user_id() = friend_id
  );
drop policy if exists "Users can delete their friendships" on public.friends;
create policy "Users can delete their friendships"
  on public.friends
  for delete
  using (
    public.request_user_id() = user_id
    or public.request_user_id() = friend_id
  );
