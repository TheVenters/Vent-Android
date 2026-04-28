#!/usr/bin/env bash
# File purpose: Shell helper script used by project setup, development, or Supabase maintenance workflows.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SUPABASE_DIR="${ROOT_DIR}/supabase"

usage() {
  cat <<'HELP'
Usage: ./scripts/pull-live-schema.sh [--check] [--no-dated]

Pulls the live remote `public` schema from the linked Supabase project.

Options:
  --check      Validate prerequisites only; do not pull or write files.
  --no-dated   Skip writing the dated copy in supabase/remote_schema_schema-sync-YYYYMMDD.sql.
  -h, --help   Show this help.
HELP
}

check_prereqs() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "error: docker is not installed. Install Docker Desktop first." >&2
    exit 1
  fi

  if ! docker info >/dev/null 2>&1; then
    echo "error: docker daemon is not running. Start Docker Desktop, then retry." >&2
    exit 1
  fi

  if ! command -v npx >/dev/null 2>&1; then
    echo "error: npx is not available." >&2
    exit 1
  fi
}

check_only=false
write_dated_copy=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      check_only=true
      shift
      ;;
    --no-dated)
      write_dated_copy=false
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

check_prereqs

if [[ "${check_only}" == "true" ]]; then
  echo "ok: prerequisites look good (docker + npx available)."
  exit 0
fi

mkdir -p "${SUPABASE_DIR}"
main_out="${SUPABASE_DIR}/main_schema_snapshot.sql"
date_tag="$(date +%Y%m%d)"
dated_out="${SUPABASE_DIR}/remote_schema_schema-sync-${date_tag}.sql"

echo "Pulling remote schema into ${main_out}..."
npx supabase db dump --linked --schema public --file "${main_out}"

if [[ "${write_dated_copy}" == "true" ]]; then
  cp "${main_out}" "${dated_out}"
  echo "Wrote dated copy: ${dated_out}"
fi

echo "Done."
