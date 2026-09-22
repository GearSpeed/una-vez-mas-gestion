# Despliegue

Un VPS con Docker Compose, detrás de Cloudflare. El servidor no abre puertos:
`cloudflared` hace un túnel de salida hacia Cloudflare, y **Cloudflare Access** decide
quién entra antes de que la petición llegue a la app.

```
Equipo ─► Cloudflare Access ─► Tunnel ─► app (API + front) ─► PostgreSQL 18
```

Servicios de `compose.prod.yml`:

| Servicio      | Qué hace                                                                |
| ------------- | ----------------------------------------------------------------------- |
| `db`          | PostgreSQL 18. La primera vez corre `db/init/01-roles.sh` (roles y BD). |
| `migraciones` | Aplica las migraciones pendientes como `gestion_owner` y termina.       |
| `app`         | La API de NestJS, que también sirve el front ya compilado.              |
| `cloudflared` | El túnel de Cloudflare.                                                 |

## 1. Servidor

- El VPS de Contabo, con Docker Engine y el plugin
  `docker compose`.
- Firewall: nada entrante, salvo SSH. Mejor aún, SSH también por Cloudflare Tunnel.
- Clonar el repo en `/srv/una-vez-mas-gestion`. Hace falta por `compose.prod.yml`,
  `db/init/` y `ops/`.

## 2. Variables (`.env` del servidor)

| Variable                  | Qué es                                                          |
| ------------------------- | --------------------------------------------------------------- |
| `POSTGRES_PASSWORD`       | Superusuario de Postgres (solo para respaldos y emergencias)    |
| `GESTION_OWNER_PASSWORD`  | Dueño del esquema; lo usan las migraciones                      |
| `GESTION_APP_PASSWORD`    | La API                                                          |
| `SITIO_LECTURA_PASSWORD`  | El back del sitio (ver `docs/contrato-sitio.md`)                |
| `CF_ACCESS_TEAM`          | `https://<tu-team>.cloudflareaccess.com`                        |
| `CF_ACCESS_AUD`           | El _Application Audience (AUD) Tag_ de la app en Access         |
| `CLOUDFLARE_TUNNEL_TOKEN` | El token del túnel                                              |
| `ADMIN_INICIAL_CORREO`    | El primer administrador (para la semilla)                       |
| `S3_ENDPOINT`             | El del Object Storage, p. ej. `https://usc1.contabostorage.com` |
| `S3_REGION`               | `default` (Contabo no usa regiones de AWS)                      |
| `S3_BUCKET`               | El bucket de las imágenes, p. ej. `imagenes`                    |
| `S3_ACCESS_KEY`           | La _access key_ S3 del Object Storage                           |
| `S3_SECRET_KEY`           | La _secret key_ S3 del Object Storage                           |
| `IMAGENES_URL_PUBLICA`    | La URL pública del bucket (ver abajo)                           |
| `IMAGEN`                  | Opcional: la imagen a usar; por omisión la de GHCR              |

Las contraseñas van dentro de URLs de conexión: usa **solo letras y números** (por
ejemplo, `openssl rand -hex 24`). El `.env` no sale del servidor.

## 3. Cloudflare

**Tunnel.** Zero Trust → Networks → Tunnels → _Create a tunnel_ (cloudflared). Copia el
token a `CLOUDFLARE_TUNNEL_TOKEN` y agrega un _public hostname_:
`gestion.unavezmasmx.com` → `http://app:3000`.

**Access.** Zero Trust → Access → Applications → _Self-hosted_:

- Dominio: `gestion.unavezmasmx.com`.
- Política «Equipo»: _Allow_ a los correos del equipo (o a un grupo de Access).
- Métodos de entrada: _One-time PIN_ (código al correo); Google es opcional.
- Duración de la sesión: 7 días, para que los vendedores no pidan código a cada rato
  en el celular.
- Cookies: _HttpOnly_ activado, _SameSite_ en `Lax`.
- Copia el **AUD tag** a `CF_ACCESS_AUD` y el dominio del team a `CF_ACCESS_TEAM`.

## 3.1 Object Storage de Contabo (imágenes de producto)

Las fotos de los productos se suben desde la app y el sitio las sirve directo del
bucket, así que tiene que ser **de lectura pública** (nadie puede escribir sin llaves).

1. En el panel de Contabo: **Object Storage → Create bucket**, en la misma región que el
   VPS. Nombre sugerido: `imagenes`.
2. En el bucket, activar **Public sharing**. Contabo da una URL como
   `https://usc1.contabostorage.com/<id-de-tu-cuenta>:imagenes`: esa va en
   `IMAGENES_URL_PUBLICA`, sin `/` al final.
3. **Account → Security & Access → S3 Object Storage Credentials**: copiar la _access key_
   y la _secret key_ a `S3_ACCESS_KEY` y `S3_SECRET_KEY`. `S3_ENDPOINT` es la parte de la
   URL hasta `.com` (`https://usc1.contabostorage.com`).

La app guarda cada foto en WebP (1200 y 600 px) con un nombre que no se repite, y con
caché de un año. Nada se borra del bucket: una foto nueva lleva otro nombre.

Para subir las fotos que hoy tiene el sitio (una sola vez, después del primer arranque):
se clona el repo del sitio en el servidor y se corre el script con la imagen de la app,
que ya trae las variables del bucket y de la BD.

```bash
git clone <repo del sitio> /srv/una-vez-mas-sitio
docker compose -f compose.prod.yml run --rm -v /srv/una-vez-mas-sitio:/sitio:ro app \
  node api/dist/cli/subir-imagenes.js /sitio
```

Empareja cada foto con su producto por el slug y usa el texto alternativo de
`products.json`. Al final lista las fotos que no tuvieron producto y los productos que se
quedaron sin foto. Se puede repetir: lo que ya se subió no se vuelve a subir.

Si más adelante las imágenes se sirven por un dominio propio con CDN (por ejemplo
`img.unavezmasmx.com` frente al bucket), basta cambiar `IMAGENES_URL_PUBLICA`: la BD guarda
solo la ruta de cada imagen, no la URL.

## 4. Primer arranque

```bash
cd /srv/una-vez-mas-gestion
docker compose -f compose.prod.yml pull          # o `build` para compilar en el servidor
docker compose -f compose.prod.yml up -d
docker compose -f compose.prod.yml run --rm migraciones node api/dist/cli/semilla.js
```

La semilla crea roles, categorías, los 13 productos, el Almacén y el administrador de
`ADMIN_INICIAL_CORREO`. Se puede correr otra vez sin problema: no pisa lo que ya se
editó en la app.

## 5. Dar de alta a alguien

Dos pasos, porque Access decide quién llega y la app decide qué puede hacer:

1. En la app: **Usuarios → Nuevo usuario**, con su correo y sus roles.
2. En Cloudflare Access: agregar el mismo correo a la política «Equipo».

Para dar de baja a alguien se hace lo contrario. Si es vendedor y todavía trae
mercancía, la app no deja desactivarlo hasta que se reciba en el almacén.

## 6. Actualizar

```bash
docker compose -f compose.prod.yml pull
docker compose -f compose.prod.yml up -d
```

Las migraciones corren solas antes de que arranque la app nueva. Si una falla, el comando
termina con error antes de levantar la app nueva: revisa
`docker compose -f compose.prod.yml logs migraciones`.

## 7. Respaldos

`ops/respaldar.sh` hace un `pg_dump`, guarda 14 días en `respaldos/` y sube una copia a
Backblaze B2 con rclone. El respaldo lleva costos y proveedores, así que el remoto debe
ser un **`crypt` de rclone** sobre B2 (el script usa `b2cifrado:gestion` por omisión).

```bash
rclone config                                     # remoto b2 y, encima, uno crypt
crontab -e
# 15 3 * * *  /srv/una-vez-mas-gestion/ops/respaldar.sh >> /var/log/respaldo-gestion.log 2>&1
```

Una vez al mes, probar que el respaldo se restaura (no toca producción):

```bash
ops/probar-respaldo.sh
```

## 8. Día a día

```bash
docker compose -f compose.prod.yml ps
docker compose -f compose.prod.yml logs -f app
docker compose -f compose.prod.yml exec db psql -U postgres -d gestion
```

La salud de la app está en `GET /api/salud` (sin identidad). El healthcheck de la imagen
la consulta.

## Revisión antes de abrir

- [ ] `.env` del servidor con contraseñas nuevas, solo letras y números.
- [ ] Access protege `gestion.unavezmasmx.com` y solo el equipo pasa.
- [ ] `AUTH_MODO=access` (la app se niega a arrancar con `desarrollo` en producción).
- [ ] El respaldo corre de noche, y `ops/probar-respaldo.sh` funcionó al menos una vez.
- [ ] El servidor no expone ningún puerto salvo SSH.
- [ ] El bucket de imágenes es de lectura pública, y sus llaves solo están en el `.env`.
