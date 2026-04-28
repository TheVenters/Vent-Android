-- File purpose: Supabase migration that applies the database change described by 20260215000007_ensure_system_core_layers.sql.

insert into public.layers (kind, name, enabled, owner_type, owner_id, is_public)
select seed.kind, seed.name, true, 'system', null, seed.is_public
from (
  values
    ('public'::text, 'Public'::text, true),
    ('friends'::text, 'Friends'::text, false),
    ('private'::text, 'Private'::text, false)
) as seed(kind, name, is_public)
where not exists (
  select 1
  from public.layers l
  where coalesce(l.owner_type, 'system') = 'system'
    and (
      lower(coalesce(l.kind, '')) = seed.kind
      or lower(coalesce(l.name, '')) = lower(seed.name)
    )
);
