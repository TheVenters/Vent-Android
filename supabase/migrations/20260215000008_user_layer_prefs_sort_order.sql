-- Add per-user layer ordering for cross-device layer order sync.
alter table if exists public.user_layer_prefs
  add column if not exists sort_order integer;
create index if not exists user_layer_prefs_user_sort_order_idx
  on public.user_layer_prefs(user_id, sort_order, layer_id);
with ranked as (
  select
    user_id,
    layer_id,
    row_number() over (
      partition by user_id
      order by created_at asc, layer_id asc
    ) - 1 as rn
  from public.user_layer_prefs
  where sort_order is null
)
update public.user_layer_prefs ulp
set sort_order = ranked.rn
from ranked
where ulp.user_id = ranked.user_id
  and ulp.layer_id = ranked.layer_id
  and ulp.sort_order is null;
