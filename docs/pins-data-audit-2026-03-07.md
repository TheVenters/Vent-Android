# Pins Data Audit (March 7, 2026)

Purpose: historical audit notes for pin media and layer data found in the live Supabase database on March 7, 2026.

## Scope
- Pulled live schema first via `npm run db:schema:pull`.
- Audited live `public.pins` rows using service-role read access.
- Reviewed all app reads/writes of pin media and layer fields.

## Live Findings
- Total pins: `40`
- Media-typed pins: `31`
- Pins with usable persisted media (`storage://` or `http(s)`): `9`
- Pins with local-only media URI in `media_url` (`file://...`): `19`
- Pins with `geometry.media_urls` array: `1`
- Pins with `geometry.media_types` array: `1`
- Pins where `layer != base_audience`: `0`
- Pins where `author_layer_id` is present: `40`
- Pins where `explicit_layer_id` is present: `40`

## Main Root Causes
1. Legacy media rows persisted local device paths (`file://...`) into `pins.media_url`.
2. Most older pins only use top-level `media_url`/`media_type` and do not have normalized media arrays in `geometry`.
3. Some UI paths could still attempt to render unresolved `storage://...` pointers directly.

## Pin Field Inventory

### Core identity and ownership
- `id`: primary key. Keep.
- `user_id`: post owner. Keep.
- `created_at`, `updated_at`: feed order and freshness. Keep.

### Content
- `type`: coarse post kind (`text`, `photo`, `video`, `media`). Keep for fast branching.
- `caption`: short headline/title. Keep.
- `content`: body text. Keep.

### Media (top-level)
- `media_url`: primary media pointer/url (legacy single-media + compatibility). Keep.
- `media_type`: primary media type (legacy single-media + compatibility). Keep.
- Status: still used heavily by account/detail UI and edge results.

### Geometry and map placement
- `lat`, `lng`: map point used for viewport/filtering. Keep.
- `geometry_type`: legacy shape hint. Mostly redundant with `geometry.type`, but still constrained/index-friendly. Keep for now.
- `geometry` (jsonb): shape + extended metadata. Keep.
  - currently carries:
    - `type`, `coordinates`
    - `layer_id`, `author_layer_id`, `author_user_id`
    - `visibility_mode`
    - optional `media_urls`, `media_types`, `media_count`

### Visibility/layer routing
- `base_audience`: canonical audience bucket (`public|friends|private`). Keep (source of truth).
- `layer`: compatibility audience text. Redundant with `base_audience` but required by existing triggers/checks and old clients. Keep for now.
- `author_layer_id`: author-owned posting layer linkage. Keep.
- `explicit_layer_id`: optional extra/community layer linkage. Keep.
- `pin_layer_memberships`: derived runtime membership map (author/base/extra). Keep.

### UX metadata
- `posted_from_current_location`: flair/label only. Keep.
- `author_name`, `author_username`: denormalized snapshot to reduce join dependence. Keep.

## Multiple Photos and Video Readiness
- Current direction is correct: use `geometry.media_urls[]` + `geometry.media_types[]` + `geometry.media_count`.
- Keep top-level `media_url`/`media_type` as the canonical first media item for backward compatibility.
- Recommended contract:
  - top-level `media_url`/`media_type` = first item of media arrays
  - arrays are source for carousel/mixed-media UI
  - never persist signed URLs; persist storage pointers (`storage://bucket/path`)

## Cleanup Strategy Implemented
- Added script: `scripts/pin-media-maintenance.js`
  - Audit mode: `npm run pins:media:audit`
  - Apply mode: `npm run pins:media:cleanup`
- Script normalizes:
  - clears local-only `media_url` values (`file://`, `content://`, `ph://`)
  - backfills `geometry.media_urls/media_types/media_count` when persistable media exists
  - aligns top-level `media_url` with first persistable media candidate
  - clears orphan `media_type` when no persistable media remains

## Post-Cleanup Snapshot (March 7, 2026)
- `pins:media:cleanup` applied updates on `30` rows (`0` failures).
- `media_url` by scheme after cleanup:
  - `storage://`: `9`
  - `file://`: `0`
  - `null`: `31`
- rows with `geometry.media_urls` after cleanup: `9`
- rows with non-null top-level `media_type` after cleanup: `9`

## Follow-up Recommendation
- Add a later migration to formalize arrays at top-level if desired (`media_urls`/`media_types` columns), but this is optional. Current `geometry` approach is workable if consistently normalized.
