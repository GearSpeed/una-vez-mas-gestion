#!/usr/bin/env bash
# Un respaldo que nunca se restauró no es respaldo. Restaura el más reciente
# (o el que se indique) en una BD temporal, cuenta registros y la borra. No
# toca la BD de producción.
#   ops/probar-respaldo.sh [respaldos/gestion-AAAA-MM-DD_HHMM.dump]
set -euo pipefail
cd "$(dirname "$0")/.."

ARCHIVO="${1:-$(ls -t respaldos/gestion-*.dump | head -1)}"
psql() { docker compose -f compose.prod.yml exec -T db psql -U postgres -v ON_ERROR_STOP=1 "$@"; }

psql -c 'DROP DATABASE IF EXISTS gestion_prueba' -c 'CREATE DATABASE gestion_prueba'
docker compose -f compose.prod.yml exec -T db \
  pg_restore -U postgres -d gestion_prueba --no-owner --no-privileges < "$ARCHIVO"
psql -d gestion_prueba -c "SELECT
  (SELECT count(*) FROM gestion.productos)   AS productos,
  (SELECT count(*) FROM gestion.compras)     AS compras,
  (SELECT count(*) FROM gestion.ventas)      AS ventas,
  (SELECT count(*) FROM gestion.movimientos) AS movimientos"
psql -c 'DROP DATABASE gestion_prueba'
echo "El respaldo $ARCHIVO se restauró bien."
