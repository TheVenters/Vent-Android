-- File purpose: Supabase migration that applies the database change described by 20260215000016_community_members_self_join_accepted.sql.

-- Allow authenticated users to join communities immediately as accepted members.
-- Keep first-member bootstrap logic for accepted admin inserts.

drop policy if exists "Users can request to join communities"
  on public.community_members;
create policy "Users can request to join communities"
  on public.community_members
  for insert
  with check (
    auth.uid() = user_id
    and (
      (status = 'accepted' and role = 'member')
      or (status = 'pending' and role = 'member')
      or (
        status = 'accepted'
        and role = 'admin'
        and public.community_member_count(community_id) = 0
      )
    )
  );
