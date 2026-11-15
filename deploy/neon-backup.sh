#!/usr/bin/env bash
# Export a compressed pg_dump of the Ethio Bingo database (Neon or any Postgres)
# and prune old copies.
#
#   DATABASE_URL='postgresql://user:pass@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require' \
#     bash deploy/neon-backup.sh
#
# Optional:
#   BACKUP_DIR        where dumps are written            (default ./backups)
#   BACKUP_KEEP_DAYS  delete dumps older than this       (default 14)
#
# Uses a local `pg_dump` when installed, otherwise the postgres:16-alpine image
# through Docker, so it also works on Windows/Git Bash without the Postgres client.
#
# Schedule it with cron:
#   0 1 * * * cd /opt/ethio-bingo && DATABASE_URL="$(grep ^DATABASE_URL= .env | cut -d= -f2-)" bash deploy/neon-backup.sh >> /var/log/ethio-bingo-backup.log 2>&1
# or with the GitHub Actions workflow in .github/workflows/neon-backup.yml.
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL to the Neon direct (non-pooler) connection string}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

case "$DATABASE_URL" in
  *-pooler.*)
    echo "error: DATABASE_URL points at Neon's pooled endpoint; pg_dump needs the direct hostname (remove '-pooler' from the host)." >&2
    exit 1
    ;;
  postgres://* | postgresql://*) ;;
  *)
    echo "error: DATABASE_URL must start with postgresql:// or postgres://" >&2
    exit 1
    ;;
esac

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
out="$BACKUP_DIR/bingo-$stamp.sql.gz"

dump() {
  if command -v pg_dump >/dev/null 2>&1; then
    pg_dump --no-owner --no-privileges --format=plain "$DATABASE_URL"
  elif command -v docker >/dev/null 2>&1; then
    docker run --rm -e DB_URL="$DATABASE_URL" postgres:16-alpine \
      sh -c 'pg_dump --no-owner --no-privileges --format=plain "$DB_URL"'
  else
    echo "error: neither pg_dump nor docker is installed" >&2
    return 1
  fi
}

# pipefail + a temp file: a failed dump must never be left behind as a valid backup.
if ! dump | gzip -9 >"$out.part"; then
  rm -f "$out.part"
  echo "backup failed: could not dump the database" >&2
  exit 1
fi

# gzip happily compresses an empty stream, so check the dump really is SQL.
if ! gzip -dc "$out.part" 2>/dev/null | head -20 | grep -q 'PostgreSQL database dump'; then
  rm -f "$out.part"
  echo "backup failed: dump does not look like a PostgreSQL dump" >&2
  exit 1
fi

mv "$out.part" "$out"

# Retention: only ever touch files this script created.
deleted=0
while IFS= read -r old; do
  rm -f "$old"
  deleted=$((deleted + 1))
done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'bingo-*.sql.gz' -mtime +"$BACKUP_KEEP_DAYS")

echo "backup written: $out ($(du -h "$out" | cut -f1))"
if [ "$deleted" -gt 0 ]; then
  echo "pruned $deleted backup(s) older than $BACKUP_KEEP_DAYS days"
fi

# Restore:
#   gunzip -c bingo-YYYY-MM-DDTHHMMSSZ.sql.gz | psql "$DATABASE_URL"
