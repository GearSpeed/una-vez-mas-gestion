#!/usr/bin/env bash
# Respaldo de la BD de producción. Pensado para el cron del servidor:
#   15 3 * * *  /srv/una-vez-mas-gestion/ops/respaldar.sh >> /var/log/respaldo-gestion.log 2>&1
#
# Guarda un pg_dump (formato custom) en respaldos/, borra los de más de 14 días
# y sube una copia a Backblaze B2 con rclone. Usa un remoto `crypt` de rclone:
# el respaldo lleva costos y proveedores, no debe quedar legible en la nube.
set -euo pipefail
cd "$(dirname "$0")/.."

DESTINO="${RESPALDOS_DIR:-./respaldos}"
REMOTO="${RESPALDOS_REMOTO:-b2cifrado:gestion}"
mkdir -p "$DESTINO"
ARCHIVO="$DESTINO/gestion-$(date +%Y-%m-%d_%H%M).dump"

docker compose -f compose.prod.yml exec -T db pg_dump -U postgres -d gestion -Fc > "$ARCHIVO"
find "$DESTINO" -name 'gestion-*.dump' -mtime +14 -delete

if command -v rclone > /dev/null; then
  rclone copy "$ARCHIVO" "$REMOTO"
else
  echo "Aviso: sin rclone, el respaldo solo quedó en el servidor." >&2
fi
echo "$(date -Is) respaldo listo: $ARCHIVO"
