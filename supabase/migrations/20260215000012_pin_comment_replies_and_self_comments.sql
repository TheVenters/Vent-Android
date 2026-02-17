-- ============================================================================
-- Pin comments: threaded replies + allow commenting on own pins
-- ============================================================================

alter table public.pin_comments
  add column if not exists parent_comment_id uuid
  references public.pin_comments(id) on delete cascade;
create index if not exists pin_comments_parent_comment_id_idx
  on public.pin_comments(parent_comment_id);
drop policy if exists "Users can add comments to visible pins they do not own" on public.pin_comments;
drop policy if exists "Users can add comments to visible pins" on public.pin_comments;
create policy "Users can add comments to visible pins"
  on public.pin_comments
  for insert
  with check (
    public.request_user_id() is not null
    and public.request_user_id() = user_id
    and public.can_view_pin_for_votes(pin_id)
    and (
      parent_comment_id is null
      or exists (
        select 1
        from public.pin_comments parent
        where parent.id = pin_comments.parent_comment_id
          and parent.pin_id = pin_comments.pin_id
      )
    )
  );
