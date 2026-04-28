-- File purpose: Supabase migration that applies the database change described by 20260215000011_pin_comments_delete_by_pin_owner.sql.

-- ============================================================================
-- Pin comments delete policy: comment author OR pin author
-- ============================================================================

drop policy if exists "Users can delete their own comments" on public.pin_comments;
drop policy if exists "Comment authors or pin owners can delete comments" on public.pin_comments;
create policy "Comment authors or pin owners can delete comments"
  on public.pin_comments
  for delete
  using (
    public.request_user_id() is not null
    and (
      user_id = public.request_user_id()
      or exists (
        select 1
        from public.pins p
        where p.id = pin_comments.pin_id
          and p.user_id = public.request_user_id()
      )
    )
  );
