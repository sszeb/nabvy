#!/usr/bin/env bash
# Migration dry-run on a throwaway Postgres, in the order the live project gets them:
#   1. Supabase stand-ins (roles, pg_net), then supabase/migrations in order (the Apify gateway);
#   2. every module's migrations through the packages/db runner (core first, then by dependsOn);
#   3. supabase/tests/*.test.sql, then packages/db/tests/*.test.sql.
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
node packages/db/scripts/migrate.mjs apply
# A second run must be a no-op: the ledger makes the runner idempotent.
node packages/db/scripts/migrate.mjs apply | grep -qx '0 migration(s) applied'
for test in supabase/tests/*.test.sql packages/db/tests/*.test.sql; do
  echo "test   $test"
  run_sql -f "$test"
done
echo "migration dry-run passed"
