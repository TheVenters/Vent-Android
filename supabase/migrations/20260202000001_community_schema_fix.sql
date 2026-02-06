do $$
begin
  -- If an older/incorrect communities table exists (missing `slug`), rebuild it.
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'communities'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'communities'
      and column_name = 'slug'
  ) then
    drop table if exists public.community_layers cascade;
    drop table if exists public.communities cascade;
  end if;
end
$$;

create table if not exists public.communities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.community_layers (
  community_id uuid not null references public.communities(id) on delete cascade,
  layer_id uuid not null references public.layers(id) on delete restrict,
  enabled boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  primary key (community_id, layer_id)
);

create index if not exists community_layers_community_id_idx
  on public.community_layers(community_id);

create index if not exists community_layers_layer_id_idx
  on public.community_layers(layer_id);
