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

- El VPS de Contabo, con Docker Engine y el plugin `docker compose`.
- Clonar el repo en `/srv/una-vez-mas-gestion`. Hace falta por `compose.prod.yml`,
  `db/init/` y `ops/`.
- **Antes de subir nada, endurecer el servidor**: la sección «Endurecer el servidor», más
  abajo, va primero. Un VPS recién entregado acepta root por contraseña y empieza a
  recibir intentos de entrada a los pocos minutos.

## 2. Variables (`.env` del servidor)

| Variable                  | Qué es                                                                         |
| ------------------------- | ------------------------------------------------------------------------------ |
| `POSTGRES_PASSWORD`       | Superusuario de Postgres (solo para respaldos y emergencias)                   |
| `GESTION_OWNER_PASSWORD`  | Dueño del esquema; lo usan las migraciones                                     |
| `GESTION_APP_PASSWORD`    | La API                                                                         |
| `SITIO_LECTURA_PASSWORD`  | El back del sitio (ver `docs/contrato-sitio.md`)                               |
| `CF_ACCESS_TEAM`          | `https://<tu-team>.cloudflareaccess.com`                                       |
| `CF_ACCESS_AUD`           | El _Application Audience (AUD) Tag_ de la app en Access                        |
| `CLOUDFLARE_TUNNEL_TOKEN` | El token del túnel                                                             |
| `ADMIN_INICIAL_CORREO`    | El primer administrador (para la semilla)                                      |
| `S3_ENDPOINT`             | El del Object Storage, p. ej. `https://usc1.contabostorage.com`                |
| `S3_REGION`               | `default` (Contabo no usa regiones de AWS)                                     |
| `S3_BUCKET`               | El bucket de las imágenes, p. ej. `imagenes`                                   |
| `S3_ACCESS_KEY`           | La _access key_ S3 del Object Storage                                          |
| `S3_SECRET_KEY`           | La _secret key_ S3 del Object Storage                                          |
| `IMAGENES_URL_PUBLICA`    | La URL pública del bucket (ver abajo)                                          |
| `IMAGEN`                  | La imagen exacta a desplegar: `…:<sha-del-commit>`, nunca `latest`             |
| `COMPOSE_FILE`            | `compose.prod.yml`, para que `docker compose` a secas no tome el de desarrollo |

Hay una plantilla lista en [`.env.prod.example`](../.env.prod.example).

Las contraseñas van dentro de URLs de conexión: usa **solo letras y números** (por
ejemplo, `openssl rand -hex 24`). El `.env` no sale del servidor y se cierra a su dueño:

```bash
chmod 600 .env && chown "$USER:$USER" .env
```

Ese archivo tiene el token del túnel: con él, cualquiera puede levantar otra copia de
`cloudflared` desde otra máquina y recibir tráfico ya autenticado. Trátalo como la llave
de la casa.

### Rotar contraseñas

Cambiar el `.env` **no cambia nada en la base**: el rol conserva su contraseña y la app
deja de conectar. Se hacen los dos pasos:

```bash
NUEVA=$(openssl rand -hex 24)
docker compose exec -T db psql -U postgres -d gestion -c "ALTER ROLE gestion_app PASSWORD '$NUEVA'"
sed -i "s|^GESTION_APP_PASSWORD=.*|GESTION_APP_PASSWORD=$NUEVA|" .env
docker compose up -d --force-recreate app
```

Lo mismo para `gestion_owner` y `sitio_lectura`. Las llaves S3 se rotan generando unas
nuevas en el panel de Contabo, cambiándolas en el `.env` y recreando la app; el token del
túnel, creando un túnel nuevo o rotándolo en Zero Trust.

## 3. Cloudflare

**Tunnel.** Zero Trust → Networks → Tunnels → _Create a tunnel_ (cloudflared). Copia el
token a `CLOUDFLARE_TUNNEL_TOKEN` y agrega un _public hostname_:
`gestion.unavezmasmx.com` → `http://app:3000`.

**Access.** Zero Trust → Access → Applications → _Self-hosted_:

- Dominio: `gestion.unavezmasmx.com`.
- Política «Equipo»: _Allow_ a los correos del equipo (o a un grupo de Access).
- Cookies: _HttpOnly_ activado, _SameSite_ en `Lax`.
- Copia el **AUD tag** a `CF_ACCESS_AUD` y el dominio del team a `CF_ACCESS_TEAM`.

**Dos políticas, no una.** El único factor para entrar a todo el sistema no debe ser una
bandeja de correo:

| Para quién      | Método de entrada                         | Sesión |
| --------------- | ----------------------------------------- | ------ |
| Administradores | SSO (Google) con doble factor obligatorio | 24 h   |
| Vendedores      | _One-time PIN_ al correo                  | 7 días |

La sesión larga de los vendedores es a propósito: entran desde el celular y sus permisos
están acotados. Activa además las notificaciones de Access (entradas desde un país nuevo)
y, si el equipo solo opera desde México, una regla de país.

**La ruta pública del catálogo.** El sitio lee `/api/publico/catalogo` sin identidad, así
que esa ruta necesita quedar fuera de Access: crea una aplicación aparte para
`gestion.unavezmasmx.com/api/publico/*` con política _Bypass_ para todos. El resto sigue
protegido. Ver [contrato-sitio.md](contrato-sitio.md).

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
docker compose pull
docker compose up -d
docker compose run --rm migraciones node api/dist/cli/semilla.js
```

La semilla crea roles, categorías, los 13 productos, el Almacén y el administrador de
`ADMIN_INICIAL_CORREO`. Se puede correr otra vez sin problema: no pisa lo que ya se
editó en la app.

## 5. Dar de alta a alguien

Dos pasos, porque Access decide quién llega y la app decide qué puede hacer:

1. En la app: **Usuarios → Nuevo usuario**, con su correo y sus roles.
2. En Cloudflare Access: agregar el mismo correo a la política «Equipo».

Para dar de baja a alguien son **tres** pasos: quitarlo de la política de Access,
desactivarlo en la app y **revocar su sesión** en Zero Trust → Users. Sin lo tercero sigue
entrando hasta que caduque su sesión. Si es vendedor y todavía trae mercancía, la app no
deja desactivarlo hasta que se reciba en el almacén.

## 6. Actualizar

Se despliega una imagen concreta, nunca `latest`: así se sabe qué está corriendo y se
puede volver a la anterior. El SHA sale del commit que quieras desplegar.

```bash
sed -i "s|^IMAGEN=.*|IMAGEN=ghcr.io/gearspeed/una-vez-mas-gestion:$SHA|" .env
docker compose pull
docker compose up -d
```

Las migraciones corren solas antes de que arranque la app nueva. Si una falla, el comando
termina con error antes de levantar la app nueva: revisa `docker compose logs migraciones`.

Para volver atrás, se pone el SHA anterior y se repite. (Con `COMPOSE_FILE` en el `.env`,
`docker compose` a secas ya usa `compose.prod.yml`.)

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
docker compose ps
docker compose logs -f app
docker compose exec db psql -U postgres -d gestion
```

La salud de la app está en `GET /api/salud` (sin identidad). El healthcheck de la imagen
la consulta.

## Endurecer el servidor

Va **antes** de instalar la aplicación. El objetivo es que el VPS termine sin ningún
puerto abierto a internet y que nadie pueda entrar como root en remoto.

> **Antes de empezar**: abre la **consola VNC del panel de Contabo** y comprueba que
> entras por ahí. Los pasos 3 y 5 pueden dejarte fuera, y esa consola es la vía de vuelta.

### Lo primero, apenas te entregan el VPS

1. **Cambiar la contraseña de root** que mandó Contabo (`passwd`): la que llegó por correo
   hay que darla por quemada.
2. **Actualizar todo**: `apt update && apt full-upgrade -y && reboot`.
3. **Un usuario sin privilegios, con tu llave**:

   ```bash
   adduser --disabled-password --gecos "" despliegue
   usermod -aG sudo despliegue
   install -d -m 700 -o despliegue -g despliegue /home/despliegue/.ssh
   # desde tu máquina:  ssh-copy-id despliegue@<ip>
   ```

   Prueba la entrada en otra terminal **sin cerrar la actual**.

4. **SSH sin root y solo con llave**, en `/etc/ssh/sshd_config.d/99-endurecido.conf`:

   ```
   PermitRootLogin no
   PasswordAuthentication no
   KbdInteractiveAuthentication no
   AuthenticationMethods publickey
   AllowUsers despliegue
   MaxAuthTries 3
   LoginGraceTime 20
   X11Forwarding no
   AllowAgentForwarding no
   AllowTcpForwarding no
   ```

   Luego `sshd -t && systemctl reload ssh`, y comprueba en otra terminal que `ssh root@…`
   ya no entra y `ssh despliegue@…` sí.

5. **Firewall que niega por omisión**:

   ```bash
   apt install -y ufw
   ufw default deny incoming && ufw default allow outgoing
   ufw allow 22/tcp comment 'temporal, hasta que funcione el túnel'
   ufw --force enable
   ```

6. **Actualizaciones de seguridad automáticas**:

   ```bash
   apt install -y unattended-upgrades needrestart
   dpkg-reconfigure -plow unattended-upgrades
   ```

   En `/etc/apt/apt.conf.d/50unattended-upgrades`, activa el reinicio automático a las
   04:00: después del respaldo de las 03:15, para no cortarlo a la mitad.

7. **fail2ban, solo mientras el 22 siga abierto**:

   ```bash
   apt install -y fail2ban
   printf '[sshd]\nenabled = true\nmaxretry = 3\nbantime = 1h\n' > /etc/fail2ban/jail.local
   systemctl enable --now fail2ban
   ```

   Cuando cierres el 22 deja de servir: ya no hay puerto donde banear, y todo el tráfico
   llega desde el contenedor del túnel con la misma IP. Ahí lo que protege es Access.

### Docker

8. Instalar Docker Engine del repositorio oficial de Docker (no el de la distribución, que
   va por detrás en parches).
9. `usermod -aG docker despliegue`. Ten claro que pertenecer al grupo `docker` equivale a
   ser root en esa máquina: es comodidad, no separación de privilegios.
10. Rotación de logs del propio Docker, en `/etc/docker/daemon.json`:

    ```json
    {
      "log-driver": "json-file",
      "log-opts": { "max-size": "10m", "max-file": "3" },
      "live-restore": true
    }
    ```

11. Limitar el diario del sistema en `/etc/systemd/journald.conf`: `SystemMaxUse=500M` y
    `MaxRetentionSec=1month`.

### SSH por el túnel, y cerrar el 22

12. En el túnel de Cloudflare, agregar el destino `ssh://localhost:22` con el hostname
    `ssh.unavezmasmx.com`, y su aplicación de Access.
13. En tu máquina, en `~/.ssh/config`:

    ```
    Host ssh.unavezmasmx.com
      ProxyCommand cloudflared access ssh --hostname %h
    ```

14. **Solo cuando eso funcione sin dudas**: `ufw delete allow 22/tcp`. A partir de ahí el
    servidor no tiene ningún puerto entrante. La vía de emergencia es la consola VNC de
    Contabo.

### Comprobaciones

```bash
ss -tulpn | grep -v 127.0.0.1     # no debería listar nada
docker compose ps                  # ningún puerto publicado
curl -s -o /dev/null -w '%{http_code}\n' "$IMAGENES_URL_PUBLICA/"                     # 403: no se puede listar
curl -s -o /dev/null -w '%{http_code}\n' -X PUT --data x "$IMAGENES_URL_PUBLICA/x.txt" # 403: no se puede escribir
```

## Revisión antes de abrir

- [ ] `.env` del servidor con contraseñas nuevas, solo letras y números, y en modo `600`.
- [ ] Access protege `gestion.unavezmasmx.com`, con las dos políticas, y solo `/api/publico/*`
      queda abierto.
- [ ] `AUTH_MODO=access` (la app se niega a arrancar con `desarrollo` en producción).
- [ ] El respaldo corre de noche, y `ops/probar-respaldo.sh` funcionó al menos una vez.
- [ ] **El servidor no expone ningún puerto**, ni siquiera SSH (entra por el túnel).
- [ ] El bucket de imágenes es de lectura pública **y nada más**: comprobado con `curl`.
- [ ] La llave de Backblaze no puede borrar, y el bucket tiene Object Lock.
- [ ] `docker compose ps` no muestra ningún puerto publicado.
