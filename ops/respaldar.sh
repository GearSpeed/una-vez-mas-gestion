#!/usr/bin/env bash
# Respaldo de la BD de producción. Pensado para el cron del servidor (como root):
#   15 3 * * *  /srv/una-vez-mas-gestion/ops/respaldar.sh >> /var/log/respaldo-gestion.log 2>&1
#
# Guarda un pg_dump (formato custom) en respaldos/, borra los de más de 3 días y sube
# una copia cifrada con rclone al destino que indique RESPALDOS_REMOTO (un remoto
# `crypt`): el respaldo lleva costos y proveedores, y no debe quedar legible ni en la
# nube ni en el servidor.
set -euo pipefail
umask 077   # el dump solo lo lee quien corre el respaldo
cd "$(dirname "$0")/.."

# El .env manda: trae las credenciales de la base (que pide contraseña incluso por el
# socket local) y, si se define, el destino remoto del respaldo.
set -a
. ./.env
set +a

DESTINO="${RESPALDOS_DIR:-./respaldos}"
REMOTO="${RESPALDOS_REMOTO:-respaldocifrado:}"
mkdir -p "$DESTINO"
chmod 700 "$DESTINO"
ARCHIVO="$DESTINO/gestion-$(date +%Y-%m-%d_%H%M).dump"
PARCIAL="$ARCHIVO.parcial"

compose() { docker compose -f compose.prod.yml "$@"; }

# Se escribe a un archivo aparte y solo se promueve si el dump se puede leer
# completo: si pg_dump se corta a media copia, no queda un respaldo inservible con
# nombre de bueno.
compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db pg_dump -U postgres -d gestion -Fc > "$PARCIAL"
if ! [ -s "$PARCIAL" ] || ! compose exec -T db pg_restore -l < "$PARCIAL" > /dev/null; then
  echo "El respaldo salió incompleto: no se guarda." >&2
  rm -f "$PARCIAL"
  exit 1
fi
mv "$PARCIAL" "$ARCHIVO"
find "$DESTINO" -name 'gestion-*.dump' -mtime +3 -delete
find "$DESTINO" -name 'gestion-*.dump.parcial' -mtime +1 -delete

if command -v rclone > /dev/null; then
  # La configuración de rclone (llaves de R2 y clave del cifrado) es de root y
  # se indica explícitamente, para que el cron no dependa de quién lo ejecute.
  export RCLONE_CONFIG="${RCLONE_CONFIG:-/root/.config/rclone/rclone.conf}"
  rclone copy "$ARCHIVO" "$REMOTO" --immutable
else
  echo "rclone no está instalado: el respaldo se quedó solo en el servidor." >&2
fi

# Con un ping a un vigilante externo (healthchecks.io u otro) te enteras cuando el
# respaldo DEJA de correr, que es cuando nadie se da cuenta.
if [ -n "${RESPALDOS_PING:-}" ]; then
  curl -fsS --max-time 10 "$RESPALDOS_PING" > /dev/null || true
fi

echo "Respaldo listo: $ARCHIVO"
