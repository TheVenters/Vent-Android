-- File purpose: Supabase migration that applies the database change described by 20260206000001_friends_replica_identity.sql.

-- Enable full replica identity for friends table
-- This allows realtime DELETE events to include user_id and friend_id
alter table public.friends replica identity full;
