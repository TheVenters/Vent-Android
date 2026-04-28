-- File purpose: Supabase migration that applies the database change described by 20260212220230_add_missing_tables.sql.

-- Adds missing tables for pins-based model
-- No separate posts
-- No group chat
-- No reactions (using pin_votes instead)

create extension if not exists pgcrypto;

-- =========================
-- COMMUNITY MEMBERSHIP
-- =========================
create table if not exists public.community_members (
  user_id uuid not null references auth.users(id) on delete cascade,
  community_id uuid not null references public.communities(id) on delete cascade,
  role text not null default 'member'
    check (role in ('member','mod','owner')),
  status text not null default 'active'
    check (status in ('active','inactive','pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  primary key (user_id, community_id)
);

create index if not exists community_members_community_idx
  on public.community_members (community_id);

create index if not exists community_members_user_idx
  on public.community_members (user_id);

-- =========================
-- USER BLOCKS
-- =========================
create table if not exists public.users_blocked (
  blocker_user uuid not null references auth.users(id) on delete cascade,
  blocked_user uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_user, blocked_user),
  constraint users_blocked_not_self check (blocker_user <> blocked_user)
);

create index if not exists users_blocked_blocker_idx
  on public.users_blocked (blocker_user);

create index if not exists users_blocked_blocked_idx
  on public.users_blocked (blocked_user);

-- =========================
-- PIN COMMENTS (threaded)
-- =========================
create table if not exists public.pin_comments (
  id uuid primary key default gen_random_uuid(),
  pin_id uuid not null references public.pins(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  parent_comment_id uuid references public.pin_comments(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

create index if not exists pin_comments_pin_idx on public.pin_comments (pin_id);
create index if not exists pin_comments_author_idx on public.pin_comments (author_id);
create index if not exists pin_comments_parent_idx on public.pin_comments (parent_comment_id);

-- =========================
-- REPORTS (moderation)
-- =========================
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  pin_id uuid references public.pins(id) on delete cascade,
  pin_comment_id uuid references public.pin_comments(id) on delete cascade,
  reason text not null,
  status text not null default 'open'
    check (status in ('open','reviewing','closed')),
  created_at timestamptz not null default now(),
  constraint reports_one_target check (
    (pin_id is not null and pin_comment_id is null) or
    (pin_id is null and pin_comment_id is not null)
  )
);

create index if not exists reports_status_idx on public.reports (status);
create index if not exists reports_reporter_idx on public.reports (reporter_user_id);
create index if not exists reports_pin_idx on public.reports (pin_id);
create index if not exists reports_pin_comment_idx on public.reports (pin_comment_id);
