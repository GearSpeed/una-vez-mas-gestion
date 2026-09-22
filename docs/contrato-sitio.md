# Contrato con el back del sitio

El sitio (`www.unavezmasmx.com`) va a mostrar precio y existencia leyendo esta misma base
de datos. Este documento es todo lo que su back necesita saber, y lo único que puede ver.

## Qué puede leer

Una sola vista: **`publico.catalogo`**. Tiene una fila por producto **activo y
publicado**:

| Columna              | Tipo                     | Qué es                                                                    |
| -------------------- | ------------------------ | ------------------------------------------------------------------------- |
| `slug`               | `text`                   | La llave con el sitio: es el `id` de `products.json` y `/catalogo/:slug`. |
| `nombre`             | `text`                   | Nombre del producto.                                                      |
| `categoria`          | `text`                   | «Galletas», «Borrachitos», «Alegrías»…                                    |
| `presentacion`       | `text` o `NULL`          | «6 pzas». `NULL` si no se ha definido.                                    |
| `precio`             | `numeric(12,2)` o `NULL` | Precio de venta en MXN. **`NULL` = «Consulta precio»**.                   |
| `existencia_total`   | `integer`                | Piezas en todas las ubicaciones (almacén y lo que traen los vendedores).  |
| `existencia_almacen` | `integer`                | Solo lo del almacén.                                                      |
| `id`                 | `integer`                | ID del producto en la app (el que llevará su código de barras).           |
| `imagen`             | `text` o `NULL`          | Foto de 1200 px de ancho (WebP), como ruta dentro del bucket.             |
| `imagen_chica`       | `text` o `NULL`          | La misma foto a 600 px, para listas y miniaturas.                         |
| `imagen_alt`         | `text` o `NULL`          | Su texto alternativo, para el atributo `alt`.                             |

Un producto sin publicar, o dado de baja, no aparece. Cómo mostrar la existencia
(«Disponible», «Últimas piezas», «Agotado»…) lo decide el sitio.

### Imágenes

Las fotos se suben desde la app al Object Storage de Contabo, que es de lectura pública,
y el sitio las sirve de ahí. La URL completa es la **URL pública del bucket** (la misma
`IMAGENES_URL_PUBLICA` del servidor de la app) más `/` más la ruta:

```
https://usc1.contabostorage.com/<cuenta>:imagenes/productos/4/3f9a1c2b7d8e6f50-1200.webp
```

Las rutas nunca cambian de contenido: una foto nueva lleva otro nombre. Se pueden guardar
en caché para siempre (el bucket manda `Cache-Control: immutable`). `imagen` es `NULL`
mientras el producto no tenga foto: el sitio decide qué mostrar en su lugar.

## Qué no puede leer

Nada más. El rol `sitio_lectura` no tiene acceso al esquema `gestion`: ni costos, ni
márgenes, ni proveedores, ni ventas, ni usuarios. La vista corre con los permisos de su
dueño, así que el sitio no necesita permisos sobre las tablas y no los tiene. Hay una
prueba que lo verifica (`api/test/bd.int-spec.ts`).

## Cómo conectarse

- **Rol**: `sitio_lectura`. Su contraseña es `SITIO_LECTURA_PASSWORD` del `.env` del
  servidor.
- **Base**: `gestion`. El `search_path` del rol ya es `publico`, así que basta con
  `catalogo`.
- **Límites**: 10 conexiones como máximo y 5 segundos por consulta.
- **Solo lectura**: cualquier escritura falla.

```sql
-- Todo el catálogo
SELECT slug, nombre, categoria, presentacion, precio, existencia_total, imagen_chica, imagen_alt
FROM catalogo
ORDER BY categoria, nombre;

-- Un producto (la página /catalogo/:slug)
SELECT precio, existencia_total FROM catalogo WHERE slug = $1;
```

`numeric` llega como texto en la mayoría de los drivers («30.00»). Conviene dejarlo así
o convertirlo solo para mostrarlo.

### Por dónde llega a la BD

En producción la BD no tiene puertos abiertos a internet. Si el back del sitio corre en
Cloudflare (Pages Functions o Workers), la ruta recomendada es **Hyperdrive con base de
datos privada**:

1. En el túnel de Cloudflare del servidor, agregar una ruta TCP hacia `db:5432`, por
   ejemplo con el hostname `bd.unavezmasmx.com`.
2. Protegerla con una aplicación de Cloudflare Access que solo admita un **service
   token**.
3. Crear el Hyperdrive con ese hostname, el service token y el usuario `sitio_lectura`.

Así el sitio lee por Cloudflare sin que Postgres quede expuesto.

## Cambios al contrato

- **Agregar** columnas a la vista está permitido y no rompe al sitio.
- **Quitar o renombrar** una columna, o cambiar su significado, se coordina antes con
  quien mantiene el back del sitio. Va en una migración nueva y se anota aquí.
- Cambiar un `slug` rompe la URL del producto en el sitio: se hace solo a propósito y
  junto con `products.json`.

| Fecha      | Cambio                                                    |
| ---------- | --------------------------------------------------------- |
| 2026-09-21 | Primera versión: `publico.catalogo` (7 columnas).         |
| 2026-09-22 | Se agregan `id`, `imagen`, `imagen_chica` e `imagen_alt`. |
