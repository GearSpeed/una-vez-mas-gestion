#!/usr/bin/env bash
# Un respaldo que nunca se restauró no es respaldo. Restaura el más reciente (o el
# que se indique) en un PostgreSQL efímero, cuenta registros y lo tira.
#
# Se restaura APARTE de producción: ni consume su disco ni su CPU, y pg_restore no
# corre como el superusuario de la base buena.
#   ops/probar-respaldo.sh [respaldos/gestion-AAAA-MM-DD_HHMM.dump]
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."

ARCHIVO="${1:-$(ls -t respaldos/gestion-*.dump | head -1)}"
CONTENEDOR="prueba-respaldo-$$"

limpiar() { docker rm -f "$CONTENEDOR" > /dev/null 2>&1 || true; }
trap limpiar EXIT

docker run --rm -d --name "$CONTENEDOR" \
  -e POSTGRES_PASSWORD="$(openssl rand -hex 16)" \
  --network none postgres:18-alpine > /dev/null

for _ in $(seq 30); do
  docker exec "$CONTENEDOR" pg_isready -U postgres > /dev/null 2>&1 && break
  sleep 1
done

docker exec -i "$CONTENEDOR" pg_restore -U postgres -d postgres --no-owner --no-privileges \
  < "$ARCHIVO"
docker exec -i "$CONTENEDOR" psql -U postgres -d postgres -c "SELECT
  (SELECT count(*) FROM gestion.productos)   AS productos,
  (SELECT count(*) FROM gestion.compras)     AS compras,
  (SELECT count(*) FROM gestion.ventas)      AS ventas,
  (SELECT count(*) FROM gestion.movimientos) AS movimientos"

echo "El respaldo $ARCHIVO se restauró bien."
