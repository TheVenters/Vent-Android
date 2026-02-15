-- Ensure authenticated users can manage their own layer preferences.
alter table if exists public.user_layer_prefs enable row level security;

drop policy if exists "Users can view their own layer prefs" on public.user_layer_prefs;
create policy "Users can view their own layer prefs"
  on public.user_layer_prefs
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own layer prefs" on public.user_layer_prefs;
create policy "Users can insert their own layer prefs"
  on public.user_layer_prefs
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own layer prefs" on public.user_layer_prefs;
create policy "Users can update their own layer prefs"
  on public.user_layer_prefs
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own layer prefs" on public.user_layer_prefs;
create policy "Users can delete their own layer prefs"
  on public.user_layer_prefs
  for delete
  using (auth.uid() = user_id);
