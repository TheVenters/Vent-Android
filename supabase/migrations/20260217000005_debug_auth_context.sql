create or replace function public.debug_auth_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  return jsonb_build_object(
    'auth_uid', auth.uid(),
    'auth_role', auth.role(),
    'request_user_id', public.request_user_id(),
    'jwt_sub', auth.jwt() ->> 'sub',
    'jwt_role', auth.jwt() ->> 'role',
    'jwt_aud', auth.jwt() ->> 'aud',
    'jwt_exp', auth.jwt() ->> 'exp',
    'has_jwt', auth.jwt() is not null
  );
end;
$$;

grant execute on function public.debug_auth_context() to anon, authenticated;
