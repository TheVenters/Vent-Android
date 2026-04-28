-- File purpose: Supabase SQL reference file or schema snapshot used for database setup and comparison.

-- Alpha v1 demo seed (idempotent).

insert into communities (slug, name, description)
values
  ('denver-demo', 'Denver Demo', 'Demo community'),
  ('denver-basemap-only', 'Denver Basemap Only', 'Basemap-only community'),
  ('denver-other', 'Denver Other', 'Ownership skip demo')
on conflict (slug) do update
  set name = excluded.name,
      description = excluded.description;

insert into layers (kind, name, enabled, owner_type, owner_id, is_public)
select 'builtin', 'osm_basemap', true, 'system', null, true
where not exists (
  select 1 from layers where kind = 'builtin' and name = 'osm_basemap'
);

insert into layers (kind, name, enabled, owner_type, owner_id, is_public)
select 'builtin', 'osm_buildings_3d', true, 'system', null, true
where not exists (
  select 1 from layers where kind = 'builtin' and name = 'osm_buildings_3d'
);

update layers
set enabled = true,
    owner_type = 'system',
    owner_id = null,
    is_public = true
where kind = 'builtin' and name in ('osm_basemap', 'osm_buildings_3d');

insert into layers (kind, name, enabled, owner_type, owner_id, is_public)
select 'user_overlay', 'denver-public-overlay', true, 'system', null, true
where not exists (
  select 1 from layers where kind = 'user_overlay' and name = 'denver-public-overlay'
);

update layers
set enabled = true,
    owner_type = 'system',
    owner_id = null,
    is_public = true
where kind = 'user_overlay' and name = 'denver-public-overlay';

with demo as (
  select id from communities where slug = 'denver-demo'
)
insert into layers (kind, name, enabled, owner_type, owner_id, is_public)
select 'user_overlay', 'denver-private-overlay', true, 'community', demo.id, false
from demo
where not exists (
  select 1 from layers where kind = 'user_overlay' and name = 'denver-private-overlay'
);

with demo as (
  select id from communities where slug = 'denver-demo'
)
update layers
set enabled = true,
    owner_type = 'community',
    owner_id = demo.id,
    is_public = false
from demo
where kind = 'user_overlay' and name = 'denver-private-overlay';

insert into community_layers (community_id, layer_id, enabled, sort_order)
select c.id, l.id, true,
       case l.name
         when 'osm_basemap' then 0
         when 'osm_buildings_3d' then 1
         when 'denver-public-overlay' then 10
         when 'denver-private-overlay' then 20
         else 50
       end
from communities c
join layers l on (
  (l.kind = 'builtin' and l.name in ('osm_basemap','osm_buildings_3d')) or
  (l.kind = 'user_overlay' and l.name in ('denver-public-overlay','denver-private-overlay'))
)
where c.slug = 'denver-demo'
on conflict (community_id, layer_id) do update
  set enabled = excluded.enabled,
      sort_order = excluded.sort_order;

insert into community_layers (community_id, layer_id, enabled, sort_order)
select c.id, l.id, true, 0
from communities c
join layers l on l.kind = 'builtin' and l.name = 'osm_basemap'
where c.slug = 'denver-basemap-only'
on conflict (community_id, layer_id) do update
  set enabled = excluded.enabled,
      sort_order = excluded.sort_order;

insert into community_layers (community_id, layer_id, enabled, sort_order)
select c.id, l.id, true,
       case l.name
         when 'osm_basemap' then 0
         when 'osm_buildings_3d' then 1
         when 'denver-private-overlay' then 50
         else 60
       end
from communities c
join layers l on (
  (l.kind = 'builtin' and l.name in ('osm_basemap','osm_buildings_3d')) or
  (l.kind = 'user_overlay' and l.name = 'denver-private-overlay')
)
where c.slug = 'denver-other'
on conflict (community_id, layer_id) do update
  set enabled = excluded.enabled,
      sort_order = excluded.sort_order;

with public_layer as (
  select id from layers where kind = 'user_overlay' and name = 'denver-public-overlay'
)
insert into overlay_features (layer_id, geom, props)
select public_layer.id,
       '{"type":"Polygon","coordinates":[[[-104.9903,39.7392],[-104.9888,39.7392],[-104.9896,39.7402],[-104.9903,39.7392]]]}'::jsonb,
       '{"seed":"alpha-v1","name":"public-triangle"}'::jsonb
from public_layer
where not exists (
  select 1
  from overlay_features f
  where f.layer_id = public_layer.id
    and f.props->>'seed' = 'alpha-v1'
    and f.props->>'name' = 'public-triangle'
);

with private_layer as (
  select id from layers where kind = 'user_overlay' and name = 'denver-private-overlay'
)
insert into overlay_features (layer_id, geom, props)
select private_layer.id,
       '{"type":"Polygon","coordinates":[[[-104.9910,39.7388],[-104.9890,39.7388],[-104.9900,39.7398],[-104.9910,39.7388]]]}'::jsonb,
       '{"seed":"alpha-v1","name":"private-triangle"}'::jsonb
from private_layer
where not exists (
  select 1
  from overlay_features f
  where f.layer_id = private_layer.id
    and f.props->>'seed' = 'alpha-v1'
    and f.props->>'name' = 'private-triangle'
);
