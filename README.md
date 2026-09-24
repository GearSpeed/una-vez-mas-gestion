# Una vez más · Gestión

Aplicativo de inventario y ventas de **Una vez más**. Reemplaza al Excel
`una-vez-mas-inventario.xlsx`: mismas cuentas (el costo de la gasolina repartido por
pieza), pero con usuarios, roles, existencia por ubicación y una base de datos que el
sitio web puede leer.

- **Compras**: cada compra es un viaje a un proveedor. La gasolina (km ÷ km/l × precio)
  se reparte parejo entre las piezas, igual que en el Excel.
- **Inventario por ubicación**: el almacén y una ubicación por vendedor. Se carga
  mercancía al vendedor y se recibe lo que regresa (traspasos); mermas, ajustes y conteo
  físico.
- **Ventas al entregar**, desde el celular del vendedor, solo con lo que trae.
- **Costo promedio ponderado móvil** por producto, y utilidad de cada venta con el
  costo que tenía en ese momento.
- **Reportes**: tablero, ventas por día/producto/vendedor/canal/método, utilidad por
  producto, corte de cada vendedor y compras con su gasolina. Exportan a CSV.
- **Roles**: Administrador, Almacén, Vendedor y Consulta. La API filtra lo que cada quien
  recibe: un vendedor nunca recibe costos ni márgenes.

## Stack

| Parte         | Qué                                                                    |
| ------------- | ---------------------------------------------------------------------- |
| `api/`        | NestJS 12, Drizzle ORM, PostgreSQL 18, Zod, `jose` (Cloudflare Access) |
| `web/`        | Angular 22 + Angular Material 3 (tema con los colores del sitio)       |
| `compartido/` | Permisos, esquemas Zod, tipos y **todas las cuentas** (big.js)         |
| Acceso        | Cloudflare Access; la app solo relaciona correo → roles                |
| Producción    | Docker Compose en un VPS, Cloudflare Tunnel (sin puertos abiertos)     |

`compartido` es la única fuente de las cuentas: la API las usa para guardar y el front
para mostrar el cálculo mientras se captura, así que las dos dan el mismo número.

## Arrancar en tu máquina

Requisitos: Node **24.15 o más** (Angular 22 lo exige; `.nvmrc` fija 24.21) y Docker.

```bash
nvm use                      # Node 24.21
npm install
cp .env.example .env         # y cambia las contraseñas
docker compose up -d db minio  # PostgreSQL 18 en :5433 y MinIO (imágenes) en :9000
npm run migrar               # crea el esquema (como gestion_owner)
npm run semilla -- --demo    # roles, 13 productos, Almacén, admin y datos de prueba
npm run preparar-bucket      # crea el bucket de imágenes en MinIO (una vez)
npm run subir-imagenes -- ../una_vez_mas_web_site  # opcional: las fotos del sitio
npm run dev                  # API en :3001 y app en http://localhost:4300
```

El MinIO local usa la imagen `bitnamilegacy/minio`: MinIO dejó de publicar imágenes que se
puedan descargar sin credenciales, y esa copia sí es pública. Es el mismo servidor, y su
consola web ya no existe (MinIO la quitó de la versión libre).

Si tu Docker Desktop está apagado y usas el motor del sistema, `docker compose` falla con
«Cannot connect to the Docker daemon». Se arregla una sola vez con
`docker context use default`, o antepone `DOCKER_HOST=unix:///var/run/docker.sock` a los
comandos de `docker` y de pruebas.

En desarrollo no hay Cloudflare Access (`AUTH_MODO=desarrollo`): entras como
`DEV_CORREO`. Con `--demo` hay un usuario por rol, y desde el menú de usuario (arriba a
la derecha) puedes **entrar como** Almacén, Ana o Beto (vendedores) o Consulta para
probar lo que ve cada rol. Ese modo se niega a arrancar si `NODE_ENV=production`.

## Scripts

| Comando                             | Qué hace                                                               |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `npm run dev`                       | compartido (watch), API (watch) y Angular (4300, con proxy)            |
| `npm run build`                     | compila los tres paquetes                                              |
| `npm test`                          | pruebas unitarias (compartido, API y web)                              |
| `npm run test:integracion`          | la API contra un PostgreSQL 18 real (Testcontainers)                   |
| `npm run e2e`                       | compila y corre Playwright + axe en escritorio y celular               |
| `npm run lint` / `format`           | oxlint (con tipos) y Prettier                                          |
| `npm run migrar`                    | aplica migraciones pendientes                                          |
| `npm run semilla [-- --demo]`       | datos iniciales; `--demo` agrega usuarios, proveedor y vehículo        |
| `npm run preparar-bucket`           | crea el bucket de imágenes en el MinIO local (solo desarrollo)         |
| `npm run subir-imagenes -- <sitio>` | sube las fotos del sitio y se las asigna a cada producto               |
| `npm run probar-imagenes`           | revisa que las fotos se sirvan y que el bucket no acepte nada de fuera |
| `npm run generar-migracion -w api`  | genera la migración a partir de `api/src/db/esquema.ts`                |

## Pruebas

- **compartido** (44): las cuentas, contra los números del Excel: la compra V001 da $28.75
  de gasolina, $0.359375 por pieza y el tejocote cuesta $17.909375; a $30 el margen sobre
  precio es 40.30 % y la ganancia sobre costo 67.51 %.
- **API unitarias**: el JWT de Access (válido, otra app, otro emisor, otra llave, vencido,
  alterado) y el CSV.
- **API integración** (100, PostgreSQL 18 real y MinIO): los mismos números del Excel de punta a
  punta, dos ventas simultáneas de la última pieza (una pasa, la otra recibe 409),
  cancelaciones, devoluciones, comisión de tarjeta, traspasos, conteo, permisos por rol, que un vendedor nunca reciba llaves
  `costo*`, y que la propia BD no deje borrar, reescribir el kardex ni dejar existencias
  negativas, que el rol del sitio no vea tablas, y las imágenes: WebP de 1200 y 600 px
  sin metadatos, servidas por el bucket, y lo que no es imagen o pesa más de 10 MB se
  rechaza; y lo que protege a la API de cara a internet: la ruta pública, el límite de
  peticiones, el rechazo de peticiones de otros sitios y los permisos de los roles de
  Postgres.
- **web** (15): menú por permisos, errores de la API, sesión y la pantalla de venta.
- **e2e** (48, Playwright): axe (WCAG 2.1 A/AA) en todas las pantallas y diálogos, en
  escritorio y en celular, y el recorrido completo: precio → compra → carga → venta →
  devolución, y subir la foto de un producto.

## Reglas del negocio

- **Costo de una pieza** = precio del proveedor + gasolina por pieza.
- **Costo promedio ponderado móvil**, uno por producto para toda la empresa. Las
  entradas lo recalculan; las salidas se valúan al promedio del momento y ese costo queda
  guardado en la venta. Un traspaso no lo mueve.
- **Todo cambio de existencia** pasa por `MovimientosService`, en la transacción del
  documento: bloquea los productos (en orden de id), mueve existencias, actualiza el
  costo y escribe el kardex. `existencias.cantidad >= 0` lo cuida también la BD.
- **Cancelar una venta** (admin, con motivo) regresa las piezas a su ubicación con el costo
  guardado. **Cancelar una compra** solo si no ha salido ninguna pieza de esos productos
  desde entonces; si ya salieron, se corrige con un ajuste. Una venta con devoluciones ya
  no se cancela.
- **Devoluciones** (el vendedor, de sus ventas; folio `D-`): por pieza y parciales. Se
  reembolsa la parte proporcional de cada línea, con el descuento aplicado y el mismo
  método con que pagó; los centavos se reparten para que al devolver todo cuadre con lo
  cobrado. Por cada producto se elige si **vuelve a la venta** (entra a la ubicación de la
  venta con el costo que se guardó) o **llegó dañado** (no entra y su costo es pérdida).
- **Comisión de tarjeta** (Mercado Pago): tasa + IVA sobre la tasa, hoy 3.50 % + 16 % =
  4.06 %. La absorbe el negocio: el cliente paga el precio normal y la venta guarda lo que
  se retiene; la utilidad ya la descuenta. El admin cambia la tasa en Productos → «Cobro
  con tarjeta» y aplica solo a ventas nuevas. Al devolver, el cliente recibe íntegro lo
  que pagó y Mercado Pago regresa la parte proporcional de su comisión (si se devuelve
  todo, la comisión completa), siempre que el reembolso se haga desde el cobro original
  («Devolver dinero» en la app de Mercado Pago), no como transferencia nueva.
- **Ajustes**: si restan, al costo promedio; si suman, al costo que se indique. El
  **conteo físico** registra lo que hay y ajusta solo las diferencias.
- **Imágenes**: una foto por producto, la misma que muestra el sitio. Se sube desde el
  diálogo del producto (JPG, PNG o WebP de hasta 10 MB, con texto alternativo); la API la
  endereza, le quita los metadatos (GPS incluido) y la guarda en WebP de 1200 y 600 px en
  un bucket de Cloudflare R2. El sitio las sirve desde `img.unavezmasmx.com`, que va por la
  caché de Cloudflare; la base guarda solo la ruta, así que cambiar de dominio o de
  proveedor es cambiar una variable.
- **ID**: cada producto muestra su ID en la tabla y en su diálogo, y las búsquedas lo
  aceptan («12» encuentra el producto 12). Es el que llevará el código de barras.
- **Precio**: sin precio no se vende (y el sitio dice «Consulta precio»). La ganancia
  objetivo es sobre el costo; en pantalla se ven lado a lado la ganancia sobre costo y
  el margen sobre precio, cada uno con su nombre.
- **Idempotencia**: cada documento lleva una clave única. Un doble toque o un reintento
  con mala señal no duplica la venta.

## Roles y permisos

Los permisos están en `compartido/src/permisos.ts`; los roles son datos (la semilla los
crea) y un usuario puede tener varios.

| Permiso                                                             | Admin | Almacén | Vendedor | Consulta |
| ------------------------------------------------------------------- | :---: | :-----: | :------: | :------: |
| `catalogo.ver` (productos, precio, existencia)                      |   ✓   |    ✓    |    ✓     |    ✓     |
| `productos.gestionar` (alta, precio, publicar)                      |   ✓   |         |          |          |
| `costos.ver` (costo, márgenes, utilidad)                            |   ✓   |         |          |    ✓     |
| `proveedores.gestionar`                                             |   ✓   |    ✓    |          |          |
| `compras.ver` / `compras.registrar` (con los costos del proveedor)  | ✓ / ✓ |  ✓ / ✓  |          |  ✓ / –   |
| `compras.cancelar`                                                  |   ✓   |         |          |          |
| `inventario.ver_todo` (todas las ubicaciones)                       |   ✓   |    ✓    |          |    ✓     |
| `traspasos.registrar` / `ajustes.registrar`                         |   ✓   |    ✓    |          |          |
| `ventas.registrar` (desde su ubicación)                             |   ✓   |         |    ✓     |          |
| `ventas.devolver` (el vendedor, solo de sus ventas)                 |   ✓   |         |    ✓     |          |
| `ventas.cualquier_ubicacion`, `ventas.descontar`, `ventas.cancelar` |   ✓   |         |          |          |
| `ventas.ver_todas` / `reportes.ver`                                 |   ✓   |         |          |    ✓     |
| `usuarios.gestionar`                                                |   ✓   |         |          |          |

El vendedor siempre ve sus propias ventas, su mercancía y su corte. Al darle a alguien el
rol Vendedor se crea sola su ubicación.

**Almacén sí ve los costos del proveedor** al abrir una compra, aunque no tenga
`costos.ver`: es quien los captura. Lo que `costos.ver` protege es el costo promedio, los
márgenes y la utilidad en productos, existencias, ventas y reportes.

## Seguridad

- **Identidad**: Cloudflare Access firma un JWT en cada petición; la API verifica firma,
  emisor y audiencia con `jose`. Nunca se confía en un correo en claro.
- **Negado por omisión**: toda ruta declara `@RequierePermiso`, `@Autenticado` o
  `@Publico`; si no, el guard la rechaza.
- **La API filtra**: todo lo que es costo va dentro de un campo `costos` que solo existe
  con `costos.ver`.
- **Roles de Postgres**: `gestion_owner` (migraciones), `gestion_app` (la API: sin
  borrar, y el kardex y la bitácora solo aceptan filas nuevas) y `sitio_lectura` (solo la
  vista `publico.catalogo`).
- **CSRF**: toda escritura debe venir del mismo origen (`Sec-Fetch-Site`) y los POST
  llegar como JSON, que un formulario de otra página no puede mandar. CSP estricta con
  helmet y `Cache-Control: no-store` en toda la API.
- **Límite de peticiones**: por usuario (o por IP sin sesión), con cubos más estrictos
  para la ruta pública y para subir imágenes.
- **Lo único sin identidad** es `GET /api/publico/catalogo`, lo que lee el sitio: sin
  ids, sin costos y sin la existencia exacta ([docs/contrato-sitio.md](docs/contrato-sitio.md)).
- **Todo lo demás**, incluida la revisión de seguridad completa y qué hay que hacer en el
  servidor, está en [docs/seguridad.md](docs/seguridad.md).
- **Datos sensibles**: costos, márgenes y proveedores no van al repo. `.gitignore` excluye
  `*.xlsx`, `.env` y respaldos; la semilla no lleva costos, precios ni proveedores reales.

## Base de datos

El esquema está en `api/src/db/esquema.ts` (Drizzle, `casing: 'snake_case'`). Las
migraciones SQL, en `api/drizzle/`:

- `0000_esquema_inicial.sql` es la generada por drizzle-kit.
- `0001_permisos_y_catalogo_publico.sql` está escrita a mano: permisos de los roles de
  Postgres y la vista para el sitio.
- `0002_devoluciones_y_comisiones.sql` la generó drizzle-kit.
- `0003_lineas_netas_y_tasa_tarjeta.sql` está escrita a mano: la vista
  `venta_lineas_netas` (cada línea ya sin lo devuelto, para reportes) y la tasa inicial
  de la tarjeta.
- `0004_comision_devuelta.sql`: la columna la generó drizzle-kit; la vista, a mano (la
  comisión de cada línea ya sin lo que Mercado Pago regresó).
- `0005_imagenes_de_productos.sql`: las columnas las generó drizzle-kit; a mano, la vista
  `publico.catalogo` gana `id`, `imagen`, `imagen_chica` e `imagen_alt`.
- `0006_endurecer_permisos_y_vistas.sql` está escrita a mano: los permisos por omisión
  dejan de repartir escritura (cada migración concede lo suyo tabla por tabla), las vistas
  internas corren con los permisos de quien consulta y el catálogo del sitio gana
  `disponibilidad`.

Una migración ya aplicada **no se edita**: cualquier cambio va en una nueva
(`npm run generar-migracion -w api`, o `--custom` para SQL a mano).

La vista `publico.catalogo` es un **contrato con el back del sitio**: ver
[docs/contrato-sitio.md](docs/contrato-sitio.md).

## Del Excel a la app

La semilla crea los 13 productos del Excel. Lo demás se captura en la app: proveedores
con sus km de ida y vuelta, vehículos con su rendimiento, y el precio de cada producto.
Las compras del Excel fueron simuladas para probarlo, así que no se migran; solo sirven
en las pruebas para comprobar que las cuentas dan lo mismo.

Slugs:

- Las galletas de chocolate son de **chispas**: `galletas-chispas-chocolate`. El sitio
  todavía las tiene como `galletas-chocolate`; su `products.json` debe cambiar a este
  slug para que la vista `publico.catalogo` las encuentre.
- Las 4 galletas nuevas: `galletas-mermelada-tejocote`, `galletas-granola`,
  `galletas-mermelada-pina` y `galletas-canela` (un slug no puede llevar `ñ`). Se crean sin
  publicar hasta que el sitio las tenga.

## Desplegar

VPS de Contabo + Docker Compose + Cloudflare Tunnel + Cloudflare Access, y las imágenes en
Cloudflare R2 servidas por `img.unavezmasmx.com`: [docs/despliegue.md](docs/despliegue.md).
La revisión de seguridad y el endurecimiento del servidor, en
[docs/seguridad.md](docs/seguridad.md).
