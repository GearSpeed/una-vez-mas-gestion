#!/usr/bin/env bash
# Crea los tres roles y la base de datos `gestion`.
#
# La imagen oficial de Postgres corre este script una sola vez, cuando el volumen
# está vacío. Es el mismo en desarrollo, en producción y en las pruebas.
#
#   gestion_owner  dueño del esquema; corre migraciones y semilla
#   gestion_app    la API: lee, inserta y actualiza, nunca borra (lo fijan las migraciones)
#   sitio_lectura  el back del sitio: solo la vista publico.catalogo
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_pw="$GESTION_OWNER_PASSWORD" \
  -v app_pw="$GESTION_APP_PASSWORD" \
  -v sitio_pw="$SITIO_LECTURA_PASSWORD" <<'EOSQL'
CREATE ROLE gestion_owner LOGIN PASSWORD :'owner_pw';
CREATE ROLE gestion_app LOGIN PASSWORD :'app_pw';
CREATE ROLE sitio_lectura LOGIN PASSWORD :'sitio_pw' CONNECTION LIMIT 10;

-- El sitio solo ve `publico` y ninguna consulta suya puede colgar a la BD.
-- Estos límites son una red contra accidentes, no un candado: un rol puede
-- levantarse los suyos. La garantía real es que no tiene permisos de escritura.
ALTER ROLE sitio_lectura SET search_path = publico;
ALTER ROLE sitio_lectura SET statement_timeout = '5s';
ALTER ROLE sitio_lectura SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE sitio_lectura SET lock_timeout = '2s';
ALTER ROLE sitio_lectura SET default_transaction_read_only = on;

-- La API tampoco debe poder dejar una transacción abierta ni una consulta colgada:
-- eso bloquea el autovacuum y agota el pool para todos.
ALTER ROLE gestion_app SET statement_timeout = '20s';
ALTER ROLE gestion_app SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE gestion_app SET lock_timeout = '5s';
ALTER ROLE gestion_app CONNECTION LIMIT 25;
ALTER ROLE gestion_owner CONNECTION LIMIT 5;

CREATE DATABASE gestion OWNER gestion_owner;
REVOKE ALL ON DATABASE gestion FROM PUBLIC;
GRANT CONNECT ON DATABASE gestion TO gestion_app, sitio_lectura;
ALTER DATABASE gestion SET timezone TO 'America/Mexico_City';
EOSQL
