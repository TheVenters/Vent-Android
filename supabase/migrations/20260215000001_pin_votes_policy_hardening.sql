-- ==========================================================================
-- Pin Votes RLS hardening
-- Avoid nested-RLS false negatives by moving pin visibility checks into
-- security-definer helper functions.
-- ==========================================================================

create or replace function public.can_view_pin_for_votes(target_pin_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.pins p
    where p.id = target_pin_id
      and (
        p.layer = 'public'
        or (
          p.layer = 'private'
          and auth.uid() = p.user_id
        )
        or (
          p.layer = 'friends'
          and (
            auth.uid() = p.user_id
            or exists (
              select 1
              from public.friends f
              where f.status = 'accepted'
                and (
                  (f.user_id = auth.uid() and f.friend_id = p.user_id)
                  or (f.friend_id = auth.uid() and f.user_id = p.user_id)
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
  select exists (
    select 1
    from public.pins p
    where p.id = target_pin_id
      and p.user_id <> auth.uid()
      and (
        p.layer = 'public'
        or (
          p.layer = 'friends'
          and (
            auth.uid() = p.user_id
            or exists (
              select 1
              from public.friends f
              where f.status = 'accepted'
                and (
                  (f.user_id = auth.uid() and f.friend_id = p.user_id)
                  or (f.friend_id = auth.uid() and f.user_id = p.user_id)
                )
            )
          )
        )
      )
  );
$$;
revoke all on function public.can_view_pin_for_votes(uuid) from public;
revoke all on function public.can_vote_on_pin(uuid) from public;
grant execute on function public.can_view_pin_for_votes(uuid) to anon;
grant execute on function public.can_view_pin_for_votes(uuid) to authenticated;
grant execute on function public.can_vote_on_pin(uuid) to anon;
grant execute on function public.can_vote_on_pin(uuid) to authenticated;
drop policy if exists "Users can view votes for visible pins" on public.pin_votes;
create policy "Users can view votes for visible pins"
  on public.pin_votes for select
  using (public.can_view_pin_for_votes(pin_id));
drop policy if exists "Users can insert their own pin votes" on public.pin_votes;
create policy "Users can insert their own pin votes"
  on public.pin_votes for insert
  with check (
    auth.uid() = user_id
    and public.can_vote_on_pin(pin_id)
  );
drop policy if exists "Users can update their own pin votes" on public.pin_votes;
create policy "Users can update their own pin votes"
  on public.pin_votes for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and public.can_vote_on_pin(pin_id)
  );
drop policy if exists "Users can delete their own pin votes" on public.pin_votes;
create policy "Users can delete their own pin votes"
  on public.pin_votes for delete
  using (auth.uid() = user_id);
