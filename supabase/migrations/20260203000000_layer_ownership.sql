alter table public.layers
  add column if not exists owner_type text not null default 'system',
  add column if not exists owner_id uuid,
  add column if not exists is_public boolean not null default true;

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
        (owner_type <> 'community' and owner_id is null)
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
      on delete restrict;
  end if;
end
$$;
