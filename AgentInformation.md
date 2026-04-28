# Agent Information

Purpose: operational notes for AI/code agents working in this repo, especially around Supabase access and schema-sensitive tasks.

## Access Status
- Supabase access is available from this workspace.
- Current app target:
  - `EXPO_PUBLIC_SUPABASE_URL=https://tweuitkgbbldzgklnicd.supabase.co`
- Service role access is configured locally via `.env`.

## Default Behavior Trigger
When asked to "read the agent info", do this before DB-sensitive work:

1. Pull live remote schema:
   - `npm run db:schema:pull`
2. If pull fails because Docker is not running:
   - Stop DB-sensitive changes.
   - Tell the user Docker Desktop must be running.
3. Review schema drift:
   - Check `git diff -- supabase/main_schema_snapshot.sql`.
4. Continue implementation only after acknowledging drift status.

## Live Schema Pull Command
- Command: `npm run db:schema:pull`
- Script: `scripts/pull-live-schema.sh`
- Writes:
  - `supabase/main_schema_snapshot.sql` (canonical latest pull)
  - `supabase/remote_schema_schema-sync-YYYYMMDD.sql` (dated copy)

## Prerequisites for Live Pull
- Docker Desktop installed and running.
- Supabase CLI available via `npx supabase`.
- Project linked to the correct remote (`tweuitkgbbldzgklnicd`).

## Current Important Data Model Notes
- `pins.layer` stores bucket values (e.g. `public`, `friends`, `private`, `events`), not `layers.id`.
- Exact selected layer linkage is stored in `pins.geometry.layer_id` by app logic.
- User ownership link for posts is stored in `pins.geometry.author_layer_id` and `pins.geometry.author_user_id` by app logic.
- Media persistence contract:
  - Persist storage pointers in DB (`storage://bucket/path`) for media.
  - Never persist local device URIs (`file://`, `content://`, `ph://`) to `pins.media_url`.
  - For multi-media posts, keep canonical arrays in `pins.geometry.media_urls` and `pins.geometry.media_types`.
  - Keep top-level `pins.media_url` / `pins.media_type` as compatibility primary-first media fields.

## Operational Rules
- Keep secrets local only (`.env`), never commit sensitive keys.
- Prefer smallest-safe change: verify schema before altering app behavior.
- When behavior depends on DB shape, verify live columns/constraints first.
- Before rendering pin media in UI, ensure values are hydrated to signed URLs or otherwise renderable URIs. Do not pass raw `storage://` values to `<Image>`.

## Pin Media Maintenance
- Audit pin media health:
  - `npm run pins:media:audit`
- Apply pin media cleanup:
  - `npm run pins:media:cleanup`
- Script path:
  - `scripts/pin-media-maintenance.js`
- Cleanup behavior:
  - removes local-only media URIs from `pins.media_url`
  - normalizes `pins.geometry.media_urls`, `pins.geometry.media_types`, `pins.geometry.media_count`
  - backfills/aligns primary media fields when persistable media exists
  - clears orphan `media_type` when media is unrecoverable

## Quick Checklist Before DB-Sensitive Changes
1. Pull and review live schema snapshot.
2. Verify RLS/policy impact for the operation.
3. Verify whether app logic relies on legacy fields (`pins.layer`) vs extended metadata (`pins.geometry.*`).
4. If media-related: run `npm run pins:media:audit` and inspect drift.
5. Implement change.
6. Validate with direct read-after-write checks.

## Known Live Drift (as of March 7, 2026)
- `layers_owner_consistency_check` now supports `owner_type='user'` with non-null `owner_id`.
- Policy `Authenticated users can create user layers` expects `owner_id = auth.uid()` (not null owner_id).
- Use `git diff -- supabase/main_schema_snapshot.sql` after each pull to confirm no additional drift before DB-sensitive edits.

## Update Log
- 2026-02-14: Created this file.
- 2026-02-14: Confirmed live Supabase write access by inserting a test row into `communities`.
- 2026-02-14: Added `user_layer_prefs` RLS migration at `supabase/migrations/20260214000001_user_layer_prefs_rls.sql`.
- 2026-03-04: Added default "read agent info" runbook to always pull live schema first via `npm run db:schema:pull`.
- 2026-03-07: Added pin media cleanup runbook (`pins:media:audit`, `pins:media:cleanup`) and media URI persistence rules.
- 2026-03-07: Recorded live schema drift for layer ownership constraint/policy to check after each schema pull.
