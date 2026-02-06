create table if not exists layers (
  id text primary key,
  name text not null,
  owner_id text not null,
  manifest jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists communities (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists community_layers (
  community_id text not null references communities(id) on delete cascade,
  layer_id text not null references layers(id) on delete cascade,
  enabled boolean not null default true,
  sort_order int not null default 0,
  primary key (community_id, layer_id)
);