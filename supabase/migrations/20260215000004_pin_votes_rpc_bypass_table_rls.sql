-- ==========================================================================
-- Pin Votes RPC hardening
-- Ensure RPC path is not blocked by pin_votes table RLS.
-- Access control remains enforced in function logic via auth.uid() checks.
-- ==========================================================================

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
      max(case when v.user_id = auth.uid() then v.vote end),
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
  acting_user uuid := auth.uid();
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
