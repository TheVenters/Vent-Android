-- ============================================================================
-- Social Features Schema: profiles, pins, friends
-- ============================================================================

-- Enable required extensions
create extension if not exists "uuid-ossp";
-- ============================================================================
-- PROFILES TABLE
-- Stores public user profile data linked to auth.users
-- ============================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text,
  avatar_url text,
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists profiles_username_idx on public.profiles(username);
-- ============================================================================
-- FRIENDS TABLE
-- Manages friend relationships and requests (created before pins for RLS reference)
-- ============================================================================
create table if not exists public.friends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, friend_id),
  check (user_id != friend_id)
);
create index if not exists friends_user_id_idx on public.friends(user_id);
create index if not exists friends_friend_id_idx on public.friends(friend_id);
create index if not exists friends_status_idx on public.friends(status);
-- ============================================================================
-- PINS TABLE
-- Location-based posts/vents
-- ============================================================================
create table if not exists public.pins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null default 'text' check (type in ('text', 'photo', 'video', 'media')),
  content text,
  caption text,
  media_url text,
  media_type text,
  lat double precision not null,
  lng double precision not null,
  layer text not null default 'public' check (layer in ('public', 'friends', 'private', 'events')),
  author_name text,
  author_username text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pins_user_id_idx on public.pins(user_id);
create index if not exists pins_layer_idx on public.pins(layer);
create index if not exists pins_created_at_idx on public.pins(created_at desc);
create index if not exists pins_location_idx on public.pins(lat, lng);
-- ============================================================================
-- ENABLE RLS ON ALL TABLES
-- ============================================================================
alter table public.profiles enable row level security;
alter table public.friends enable row level security;
alter table public.pins enable row level security;
-- ============================================================================
-- PROFILES POLICIES
-- ============================================================================
create policy "Profiles are viewable by everyone"
  on public.profiles for select
  using (true);
create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);
create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
-- ============================================================================
-- FRIENDS POLICIES
-- ============================================================================
create policy "Users can view their own friendships"
  on public.friends for select
  using (auth.uid() = user_id or auth.uid() = friend_id);
create policy "Users can send friend requests"
  on public.friends for insert
  with check (auth.uid() = user_id);
create policy "Users can update their friendships"
  on public.friends for update
  using (auth.uid() = user_id or auth.uid() = friend_id)
  with check (auth.uid() = user_id or auth.uid() = friend_id);
create policy "Users can delete their friendships"
  on public.friends for delete
  using (auth.uid() = user_id or auth.uid() = friend_id);
-- ============================================================================
-- PINS POLICIES
-- ============================================================================
create policy "Public pins are viewable by everyone"
  on public.pins for select
  using (layer = 'public');
create policy "Private pins are viewable by owner"
  on public.pins for select
  using (layer = 'private' and auth.uid() = user_id);
create policy "Friends pins are viewable by friends"
  on public.pins for select
  using (
    layer = 'friends' and (
      auth.uid() = user_id or
      exists (
        select 1 from public.friends
        where status = 'accepted'
        and (
          (user_id = auth.uid() and friend_id = pins.user_id) or
          (friend_id = auth.uid() and user_id = pins.user_id)
        )
      )
    )
  );
create policy "Users can insert their own pins"
  on public.pins for insert
  with check (auth.uid() = user_id);
create policy "Users can update their own pins"
  on public.pins for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "Users can delete their own pins"
  on public.pins for delete
  using (auth.uid() = user_id);
-- ============================================================================
-- REALTIME SUBSCRIPTIONS
-- ============================================================================
alter publication supabase_realtime add table public.pins;
alter publication supabase_realtime add table public.friends;
-- ============================================================================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================================================
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.update_updated_at();
create trigger pins_updated_at
  before update on public.pins
  for each row execute function public.update_updated_at();
create trigger friends_updated_at
  before update on public.friends
  for each row execute function public.update_updated_at();
-- ============================================================================
-- AUTO-CREATE PROFILE ON USER SIGNUP
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'user_' || substr(new.id::text, 1, 8)),
    coalesce(new.raw_user_meta_data->>'display_name', 'New User')
  );
  return new;
end;
$$ language plpgsql security definer;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
