-- ============================================================================
-- Community ownership + layer security hardening
-- ============================================================================

-- Track explicit community owner for deterministic UI/permissions semantics.
alter table if exists public.communities
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null;

create index if not exists communities_owner_user_id_idx
  on public.communities(owner_user_id);

with ranked_admins as (
  select
    cm.community_id,
    cm.user_id,
    row_number() over (
      partition by cm.community_id
      order by cm.created_at asc, cm.user_id asc
    ) as rn
  from public.community_members cm
  where cm.status = 'accepted'
    and cm.role = 'admin'
)
update public.communities c
set owner_user_id = ra.user_id
from ranked_admins ra
where c.id = ra.community_id
  and c.owner_user_id is null
  and ra.rn = 1;

-- Tighten create policy to prevent spoofed owner assignments.
drop policy if exists "Authenticated users can create communities" on public.communities;
create policy "Authenticated users can create communities"
  on public.communities for insert
  with check (
    auth.uid() is not null
    and (owner_user_id is null or owner_user_id = auth.uid())
  );

-- Lock down community layer links to community admins.
alter table if exists public.community_layers enable row level security;

drop policy if exists "Community layers are viewable by everyone" on public.community_layers;
create policy "Community layers are viewable by everyone"
  on public.community_layers for select
  using (true);

drop policy if exists "Community admins can manage community layers" on public.community_layers;
create policy "Community admins can manage community layers"
  on public.community_layers for all
  using (public.is_community_admin(community_id))
  with check (public.is_community_admin(community_id));

-- Lock down community-owned layer writes. Keep user-layer creation allowed.
alter table if exists public.layers enable row level security;

drop policy if exists "Layers are viewable by everyone" on public.layers;
create policy "Layers are viewable by everyone"
  on public.layers for select
  using (true);

drop policy if exists "Authenticated users can create user layers" on public.layers;
create policy "Authenticated users can create user layers"
  on public.layers for insert
  with check (
    auth.uid() is not null
    and owner_type = 'user'
    and owner_id is null
  );

drop policy if exists "Community admins can create community layers" on public.layers;
create policy "Community admins can create community layers"
  on public.layers for insert
  with check (
    auth.uid() is not null
    and owner_type = 'community'
    and owner_id is not null
    and public.is_community_admin(owner_id)
  );

drop policy if exists "Community admins can update community layers" on public.layers;
create policy "Community admins can update community layers"
  on public.layers for update
  using (
    owner_type = 'community'
    and owner_id is not null
    and public.is_community_admin(owner_id)
  )
  with check (
    owner_type = 'community'
    and owner_id is not null
    and public.is_community_admin(owner_id)
  );

drop policy if exists "Community admins can delete community layers" on public.layers;
create policy "Community admins can delete community layers"
  on public.layers for delete
  using (
    owner_type = 'community'
    and owner_id is not null
    and public.is_community_admin(owner_id)
  );
