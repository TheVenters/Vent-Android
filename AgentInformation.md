# Agent Information

## Access Status
- Supabase access is available from this workspace.
- Current app target is:
  - `EXPO_PUBLIC_SUPABASE_URL=https://tweuitkgbbldzgklnicd.supabase.co`
- Service role access is configured locally via `.env`.

## Can SQL Be Pulled On Demand?
Yes.

I can retrieve schema/data in two ways:
1. From local migration files in `supabase/migrations/`.
2. From live Supabase (direct queries using service role credentials from local `.env`).

## Recommended Pull Methods
- Local schema context:
  - Read files in `supabase/migrations/`
- Live table/column checks:
  - Query `information_schema.columns`
  - Query `pg_catalog` for constraints/indexes
- Live data checks:
  - Read specific tables with targeted filters and limits

## Current Important Data Model Notes
- `pins.layer` currently stores bucket values (e.g. `public`, `friends`, `private`, `events`), not `layers.id`.
- Exact selected layer linkage is currently stored in `pins.geometry.layer_id` by app logic.
- User ownership link for posts is currently stored in `pins.geometry.author_layer_id` and `pins.geometry.author_user_id` by app logic.

## Operational Rules
- Keep secrets local only (`.env`), never commit sensitive keys.
- Prefer smallest-safe change: verify schema before altering app behavior.
- When behavior depends on DB shape, verify live columns/constraints first.

## Update Log
- 2026-02-14: Created this file.
- 2026-02-14: Confirmed live Supabase write access by inserting a test row into `communities`.
- 2026-02-14: Added `user_layer_prefs` RLS migration at `supabase/migrations/20260214000001_user_layer_prefs_rls.sql` to allow authenticated users to manage their own layer toggle preferences.

## Quick Checklist Before DB-Sensitive Changes
1. Verify current table columns and constraints live.
2. Verify RLS/policy impact for the specific operation.
3. Verify whether app logic relies on legacy fields (`pins.layer`) vs extended metadata (`pins.geometry.*`).
4. Implement change.
5. Validate with a direct read-after-write check.
