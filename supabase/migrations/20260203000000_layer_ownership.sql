-- File purpose: Supabase migration that applies the database change described by 20260203000000_layer_ownership.sql.

alter table public.layers
  add column if not exists owner_type text not null default 'system',
  add column if not exists owner_id uuid,
  add column if not exists is_public boolean not null default true;

-- Backfill/normalize pre-existing rows before adding ownership constraints.
-- Older environments can have mixed values from manual edits or partial deploys.
do $$
begin
  -- If this layer is linked to at least one community, prefer that community ownership.
  if to_regclass('public.community_layers') is not null then
    update public.layers l
    set
      owner_type = 'community',
      owner_id = x.community_id
    from (
      select distinct on (cl.layer_id)
        cl.layer_id,
        cl.community_id
      from public.community_layers cl
      order by cl.layer_id, cl.community_id
    ) x
    where l.id = x.layer_id
      and (
        coalesce(l.owner_type, '') <> 'community'
        or l.owner_id is distinct from x.community_id
      );
  end if;

  -- Ensure owner_type only uses supported values.
  update public.layers
  set owner_type = case when owner_id is not null then 'community' else 'system' end
  where owner_type is null
    or owner_type not in ('system', 'community', 'user');

  -- If owner_type is community but owner_id is missing, fall back to system ownership.
  update public.layers
  set owner_type = 'system'
  where owner_type = 'community'
    and owner_id is null;

  -- If owner_type is non-community but owner_id is present, preserve community ownership
  -- when possible, otherwise clear owner_id.
  update public.layers l
  set owner_type = 'community'
  where l.owner_type <> 'community'
    and l.owner_id is not null
    and exists (
      select 1
      from public.communities c
      where c.id = l.owner_id
    );

  -- System-owned rows should never keep owner_id.
  update public.layers l
  set owner_id = null
  where l.owner_type = 'system'
    and l.owner_id is not null;

  -- Community-owned rows must reference an existing community.
  update public.layers l
  set
    owner_type = 'system',
    owner_id = null
  where l.owner_type = 'community'
    and (
      l.owner_id is null
      or not exists (
        select 1
        from public.communities c
        where c.id = l.owner_id
      )
    );
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'layers_owner_type_check'
  ) then
    alter table public.layers
      add constraint layers_owner_type_check
      check (owner_type in ('system','community','user'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'layers_owner_consistency_check'
  ) then
    alter table public.layers
      add constraint layers_owner_consistency_check
      check (
        (owner_type = 'community' and owner_id is not null)
        or
        (owner_type = 'system' and owner_id is null)
        or
        (owner_type = 'user')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'layers_owner_id_fkey'
  ) then
    alter table public.layers
      add constraint layers_owner_id_fkey
      foreign key (owner_id)
      references public.communities(id)
      not valid
      on delete restrict;
  end if;
end
$$;
