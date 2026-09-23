#!/usr/bin/env bash
# Purga la bitácora más vieja que la retención. Pensado para el cron mensual:
#   30 4 1 * *  /srv/una-vez-mas-gestion/ops/purgar-bitacora.sh >> /var/log/respaldo-gestion.log 2>&1
#
# Corre como gestion_owner: la API (gestion_app) no tiene DELETE sobre la bitácora
# y así debe seguir. La bitácora guarda quién cambió precios, canceló o devolvió;
# 24 meses es lo que se conserva por omisión.
set -euo pipefail
cd "$(dirname "$0")/.."

MESES="${BITACORA_MESES:-24}"

docker compose -f compose.prod.yml exec -T db \
  psql -U gestion_owner -d gestion -v ON_ERROR_STOP=1 -c \
  "DELETE FROM gestion.bitacora WHERE registrado_en < now() - interval '${MESES} months'"

echo "Bitácora purgada: se conservan los últimos ${MESES} meses."
