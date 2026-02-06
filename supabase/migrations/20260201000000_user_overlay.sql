create extension if not exists pgcrypto;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'layers'
      and column_name = 'id'
      and data_type <> 'uuid'
  ) then
    drop table if exists public.overlay_features cascade;
    drop table if exists public.layers cascade;
  end if;
end
$$;

create table if not exists public.layers (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  name text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.overlay_features (
  id uuid primary key default gen_random_uuid(),
  layer_id uuid not null references public.layers(id) on delete cascade,
  geom jsonb not null,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists overlay_features_layer_id_idx
  on public.overlay_features(layer_id);
