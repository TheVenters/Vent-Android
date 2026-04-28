-- File purpose: Supabase migration that applies the database change described by 20260218000001_fix_pin_membership_rebuild_and_base_uniqueness.sql.

begin;

-- Keep pin memberships rebuild independent of any named unique constraint.
-- Uses PK (pin_id, layer_id) for upserts and writes exactly one base membership.
create or replace function public.rebuild_pin_layer_memberships(p_pin_id uuid)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_pin public.pins%rowtype;
  v_public_layer_id uuid;
  v_friends_layer_id uuid;
  v_private_layer_id uuid;
  v_base_layer_id uuid;
begin
  select *
    into v_pin
  from public.pins
  where id = p_pin_id;

  if not found then
    return;
  end if;

  -- Rebuild managed memberships from source-of-truth pin fields.
  delete from public.pin_layer_memberships
  where pin_id = p_pin_id
    and membership_role in ('author', 'base');

  -- Keep explicit target as an extra membership if present.
  if v_pin.explicit_layer_id is not null then
    insert into public.pin_layer_memberships (pin_id, layer_id, membership_role)
    values (p_pin_id, v_pin.explicit_layer_id, 'extra')
    on conflict (pin_id, layer_id) do update
      set membership_role = excluded.membership_role;
  end if;

  -- Keep author's user layer membership if known.
  if v_pin.author_layer_id is not null then
    insert into public.pin_layer_memberships (pin_id, layer_id, membership_role)
    values (p_pin_id, v_pin.author_layer_id, 'author')
    on conflict (pin_id, layer_id) do update
      set membership_role = excluded.membership_role;
  end if;

  -- Resolve canonical system layer ids.
  select l.id into v_public_layer_id
  from public.layers l
  where coalesce(l.owner_type, 'system') = 'system'
    and (
      lower(coalesce(l.kind, '')) = 'public'
      or lower(coalesce(l.name, '')) = 'public'
    )
  order by l.created_at asc, l.id asc
  limit 1;

  select l.id into v_friends_layer_id
  from public.layers l
  where coalesce(l.owner_type, 'system') = 'system'
    and (
      lower(coalesce(l.kind, '')) = 'friends'
      or lower(coalesce(l.name, '')) = 'friends'
    )
  order by l.created_at asc, l.id asc
  limit 1;

  select l.id into v_private_layer_id
  from public.layers l
  where coalesce(l.owner_type, 'system') = 'system'
    and (
      lower(coalesce(l.kind, '')) = 'private'
      or lower(coalesce(l.name, '')) = 'private'
    )
  order by l.created_at asc, l.id asc
  limit 1;

  -- Exactly one base membership per pin.
  v_base_layer_id := case v_pin.base_audience
    when 'public'::public.pin_base_audience then v_public_layer_id
    when 'friends'::public.pin_base_audience then v_friends_layer_id
    else v_private_layer_id
  end;

  if v_base_layer_id is not null then
    insert into public.pin_layer_memberships (pin_id, layer_id, membership_role)
    values (p_pin_id, v_base_layer_id, 'base')
    on conflict (pin_id, layer_id) do update
      set membership_role = excluded.membership_role;
  end if;
end;
$$;

-- Normalize legacy rows to one base row per pin before unique index creation.
with ranked_base as (
  select
    plm.pin_id,
    plm.layer_id,
    row_number() over (
      partition by plm.pin_id
      order by
        case
          when lower(coalesce(l.kind, '')) = lower(p.base_audience::text) then 0
          when lower(coalesce(l.name, '')) = lower(p.base_audience::text) then 0
          else 1
        end,
        plm.created_at desc,
        plm.layer_id asc
    ) as rn
  from public.pin_layer_memberships plm
  join public.pins p on p.id = plm.pin_id
  left join public.layers l on l.id = plm.layer_id
  where plm.membership_role = 'base'
)
delete from public.pin_layer_memberships d
using ranked_base rb
where d.pin_id = rb.pin_id
  and d.layer_id = rb.layer_id
  and rb.rn > 1;

-- Backfill with current function logic to ensure consistency.
do $$
declare
  r record;
begin
  for r in select id from public.pins loop
    perform public.rebuild_pin_layer_memberships(r.id);
  end loop;
end $$;

-- Enforce invariant: one base membership per pin.
create unique index if not exists pin_layer_memberships_one_base_per_pin_idx
  on public.pin_layer_memberships (pin_id)
  where membership_role = 'base';

commit;
