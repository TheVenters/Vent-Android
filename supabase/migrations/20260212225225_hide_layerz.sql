-- File purpose: Supabase migration that applies the database change described by 20260212225225_hide_layerz.sql.

-- 1️⃣ Create table
create table if not exists public.user_layer_prefs (
  user_id uuid not null
    references auth.users(id) on delete cascade,

  layer_id uuid not null
    references public.layers(id) on delete cascade,

  hidden boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (user_id, layer_id)
);

-- 2️⃣ Indexes (performance)
create index if not exists user_layer_prefs_user_id_idx
  on public.user_layer_prefs(user_id);

create index if not exists user_layer_prefs_layer_id_idx
  on public.user_layer_prefs(layer_id);

-- 3️⃣ Auto-update updated_at
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_user_layer_prefs_updated_at
  on public.user_layer_prefs;

create trigger trg_user_layer_prefs_updated_at
before update on public.user_layer_prefs
for each row
execute function public.set_updated_at();

-- 4️⃣ Enable RLS
alter table public.user_layer_prefs enable row level security;

-- 5️⃣ Policies

create policy "read own layer prefs"
on public.user_layer_prefs
for select
using (auth.uid() = user_id);

create policy "insert own layer prefs"
on public.user_layer_prefs
for insert
with check (auth.uid() = user_id);

create policy "update own layer prefs"
on public.user_layer_prefs
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "delete own layer prefs"
on public.user_layer_prefs
for delete
using (auth.uid() = user_id);
