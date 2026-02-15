-- ============================================================================
-- Messages Table for Direct Messaging between Friends
-- ============================================================================

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  read boolean not null default false,
  created_at timestamptz not null default now(),
  -- Prevent self-messaging
  check (sender_id != receiver_id)
);
-- Indexes for efficient querying
create index if not exists messages_sender_id_idx on public.messages(sender_id);
create index if not exists messages_receiver_id_idx on public.messages(receiver_id);
create index if not exists messages_created_at_idx on public.messages(created_at desc);
-- Composite index for conversation queries
create index if not exists messages_conversation_idx on public.messages(sender_id, receiver_id, created_at desc);
-- Enable RLS
alter table public.messages enable row level security;
-- Users can only view messages they sent or received
create policy "Users can view their own messages"
  on public.messages for select
  using (auth.uid() = sender_id or auth.uid() = receiver_id);
-- Users can only send messages to their friends
create policy "Users can send messages to friends"
  on public.messages for insert
  with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.friends
      where status = 'accepted'
      and (
        (user_id = auth.uid() and friend_id = receiver_id) or
        (friend_id = auth.uid() and user_id = receiver_id)
      )
    )
  );
-- Users can update their own sent messages (for read receipts on received)
create policy "Users can update messages they received"
  on public.messages for update
  using (auth.uid() = receiver_id)
  with check (auth.uid() = receiver_id);
-- Users can delete their own messages
create policy "Users can delete their own messages"
  on public.messages for delete
  using (auth.uid() = sender_id);
-- Enable realtime
alter publication supabase_realtime add table public.messages;
-- Full replica identity for realtime deletes
alter table public.messages replica identity full;
-- Updated at trigger (for read status changes)
create trigger messages_updated_at
  before update on public.messages
  for each row execute function public.update_updated_at();
