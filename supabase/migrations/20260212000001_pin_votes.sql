-- ==========================================================================
-- Pin Votes: thumbs up / thumbs down by non-authors
-- ==========================================================================

create table if not exists public.pin_votes (
  id uuid primary key default gen_random_uuid(),
  pin_id uuid not null references public.pins(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  vote smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(pin_id, user_id)
);

create index if not exists pin_votes_pin_id_idx on public.pin_votes(pin_id);
create index if not exists pin_votes_user_id_idx on public.pin_votes(user_id);

alter table public.pin_votes enable row level security;

-- Users can view votes for pins they can already view
create policy "Users can view votes for visible pins"
  on public.pin_votes for select
  using (
    exists (
      select 1
      from public.pins p
      where p.id = pin_votes.pin_id
      and (
        p.layer = 'public'
        or (p.layer = 'private' and auth.uid() = p.user_id)
        or (
          p.layer = 'friends'
          and (
            auth.uid() = p.user_id
            or exists (
              select 1 from public.friends f
              where f.status = 'accepted'
              and (
                (f.user_id = auth.uid() and f.friend_id = p.user_id)
                or (f.friend_id = auth.uid() and f.user_id = p.user_id)
              )
            )
          )
        )
      )
    )
  );

-- Only signed-in non-authors can vote as themselves
create policy "Users can insert their own pin votes"
  on public.pin_votes for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.pins p
      where p.id = pin_votes.pin_id
      and p.user_id <> auth.uid()
    )
  );

create policy "Users can update their own pin votes"
  on public.pin_votes for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.pins p
      where p.id = pin_votes.pin_id
      and p.user_id <> auth.uid()
    )
  );

create policy "Users can delete their own pin votes"
  on public.pin_votes for delete
  using (auth.uid() = user_id);

create trigger pin_votes_updated_at
  before update on public.pin_votes
  for each row execute function public.update_updated_at();

alter publication supabase_realtime add table public.pin_votes;
