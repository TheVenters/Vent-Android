-- File purpose: Supabase migration that applies the database change described by 20260215000002_pin_votes_policy_relax_voteable_check.sql.

-- ==========================================================================
-- Pin Votes RLS follow-up
-- Relax vote eligibility to match original behavior:
-- authenticated users can vote on any existing pin they do not own.
-- ==========================================================================

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
  );
$$;
