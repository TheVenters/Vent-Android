-- ============================================================================
-- Auth identity fallback hardening + legacy friendship status compatibility.
-- ============================================================================

create or replace function public.request_user_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  resolved uuid;
  claim_user_id text;
  claim_email text;
begin
  resolved := auth.uid();
  if resolved is not null then
    return resolved;
  end if;

  -- Supabase access tokens typically include `sub` as the canonical user id.
  claim_user_id := coalesce(
    nullif(auth.jwt() ->> 'user_id', ''),
    nullif(auth.jwt() ->> 'id', ''),
    nullif(auth.jwt() ->> 'sub', '')
  );

  if claim_user_id is not null then
    begin
      resolved := claim_user_id::uuid;
      return resolved;
    exception
      when others then
        resolved := null;
    end;
  end if;

  claim_email := nullif(auth.jwt() ->> 'email', '');
  if claim_email is not null then
    select u.id
      into resolved
    from auth.users u
    where lower(u.email) = lower(claim_email)
    limit 1;
  end if;

  return resolved;
end;
$$;

drop policy if exists "Users can send messages to friends" on public.messages;
create policy "Users can send messages to friends"
  on public.messages for insert
  with check (
    public.request_user_id() = sender_id
    and exists (
      select 1
      from public.friends f
      where f.status in ('accepted', 'active')
        and (
          (f.user_id = public.request_user_id() and f.friend_id = receiver_id)
          or (f.friend_id = public.request_user_id() and f.user_id = receiver_id)
        )
    )
  );
