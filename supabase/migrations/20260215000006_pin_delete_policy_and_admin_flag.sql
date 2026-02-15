alter table public.profiles
  add column if not exists is_admin boolean not null default false;

drop policy if exists "Users can delete their own pins" on public.pins;
create policy "Users can delete their own pins"
  on public.pins for delete
  using (auth.uid() = user_id);

drop policy if exists "Admins can delete pins" on public.pins;
create policy "Admins can delete pins"
  on public.pins for delete
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.is_admin, false) = true
    )
  );
