-- Private pins should be visible only to the owner (not friends).

drop policy if exists "Private pins are viewable by owner and friends" on public.pins;
drop policy if exists "Private pins are viewable by owner" on public.pins;

create policy "Private pins are viewable by owner"
  on public.pins for select
  using (
    layer = 'private'
    and public.request_user_id() = user_id
  );

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
