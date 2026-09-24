#!/usr/bin/env bash
# Applies supabase/migrations in order to a throwaway Postgres, then runs supabase/tests/*.test.sql.
# Connection comes from the standard PG* variables. Refuses anything but a local database.
set -euo pipefail
cd "$(dirname "$0")/.."

host="${PGHOST:-localhost}"
case "$host" in
  localhost | 127.0.0.1 | ::1 | /*) ;;
  *)
    echo "Refusing to run: PGHOST=$host is not a local throwaway database." >&2
    exit 1
    ;;
esac

run_sql() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
skip_line='create extension if not exists pg_net with schema extensions;'

run_sql -f supabase/tests/supabase-stubs.sql
for migration in supabase/migrations/*.sql; do
  echo "apply  $migration"
  grep -vxF "$skip_line" "$migration" | run_sql -f -
done
for test in supabase/tests/*.test.sql; do
  echo "test   $test"
  run_sql -f "$test"
done
echo "migration dry-run passed"
