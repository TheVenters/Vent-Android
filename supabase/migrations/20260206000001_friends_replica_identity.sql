-- Enable full replica identity for friends table
-- This allows realtime DELETE events to include user_id and friend_id
alter table public.friends replica identity full;
