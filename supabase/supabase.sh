#!/usr/bin/env bash
set -euo pipefail

SUPABASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKDIR="$(cd "${SUPABASE_DIR}/.." && pwd)"

if ! command -v supabase >/dev/null 2>&1; then
  echo "error: supabase CLI not found. Install from https://supabase.com/docs/guides/cli" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker not found. Install Docker Desktop (required for local Supabase)." >&2
  exit 1
fi

cmd="${1:-}"
shift || true

ensure_seed() {
  if [[ ! -f "${SUPABASE_DIR}/seed.sql" ]]; then
    mkdir -p "${SUPABASE_DIR}"
    cat > "${SUPABASE_DIR}/seed.sql" <<'SQL'
-- Local dev seed file.
-- Keep empty for now; this file exists so `supabase db reset` succeeds.
SQL
  fi
}

case "$cmd" in
  start)
    ensure_seed
    echo "Using workdir ${WORKDIR}"
    supabase start --workdir "${WORKDIR}" "$@"
    ;;
  stop)
    echo "Using workdir ${WORKDIR}"
    supabase stop --workdir "${WORKDIR}" "$@"
    ;;
  status)
    echo "Using workdir ${WORKDIR}"
    supabase status --workdir "${WORKDIR}" "$@"
    ;;
  reset)
    echo "WARNING: this will wipe local database data and re-apply migrations/seeds."
    echo "Using workdir ${WORKDIR}"
    supabase db reset --workdir "${WORKDIR}" --yes "$@"
    ;;
  smoke)
    # Strong connectivity check without requiring local psql.
    db_container="$(docker ps --format '{{.Names}}' | grep -E '^supabase_db_' | head -n 1 || true)"
    if [[ -z "${db_container}" ]]; then
      echo "error: could not find a running supabase db container; is `supabase start` running?" >&2
      exit 1
    fi
    echo "db container: ${db_container}"
    docker exec "${db_container}" pg_isready -U postgres
    docker exec "${db_container}" psql -U postgres -d postgres -c 'select 1' >/dev/null
    echo "ok: database reachable"
    ;;
  *)
    cat <<'HELP'
Usage: ./supabase.sh <command>

Commands:
  start   Start local Supabase stack (persistent Docker volumes)
  stop    Stop local Supabase stack (data persists)
  status  Show local Supabase endpoints/keys
  reset   Wipe local DB and re-apply migrations (DESTRUCTIVE)
  smoke   Verify DB is reachable (pg_isready + select 1)
HELP
    exit 2
    ;;
esac
