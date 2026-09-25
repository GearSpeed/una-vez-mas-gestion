# Contrato con el back del sitio

El sitio (`www.unavezmasmx.com`) muestra precio, disponibilidad e imágenes leyendo esta
aplicación. Este documento es todo lo que su back necesita saber, y lo único que puede ver.

El sitio **no se conecta a la base de datos**. Lee una ruta HTTP de solo lectura, cacheada
en Cloudflare. Así el motor de base de datos no queda expuesto a nada (ver
[seguridad.md](seguridad.md)).

## Qué se lee

```
GET https://gestion.unavezmasmx.com/api/publico/catalogo
```

Sin identidad, sin llaves, sin cabeceras especiales. Responde un arreglo con una entrada
por producto **activo y publicado**, ordenado por categoría y nombre:

```json
[
  {
    "slug": "galletas-avena",
    "nombre": "Galletas de Avena",
    "categoria": "Galletas",
    "presentacion": "6 pzas",
    "descripcion": "Galletas suaves de avena con amaranto, horneadas el mismo día.",
    "ingredientes": ["avena", "amaranto", "miel de agave"],
    "precio": "30.00",
    "disponibilidad": "disponible",
    "imagen": {
      "url": "https://img.unavezmasmx.com/productos/1/3f9a1c2b7d8e6f50-1200.webp",
      "urlChica": "https://img.unavezmasmx.com/productos/1/3f9a1c2b7d8e6f50-600.webp",
      "alt": "Galletas de avena con amaranto sobre un plato de barro"
    }
  }
]
```

| Campo            | Tipo            | Qué es                                                                    |
| ---------------- | --------------- | ------------------------------------------------------------------------- |
| `slug`           | texto           | La llave con el sitio: es el `id` de `products.json` y `/catalogo/:slug`  |
| `nombre`         | texto           | Nombre del producto                                                       |
| `categoria`      | texto           | «Galletas», «Borrachitos», «Alegrías»…                                    |
| `presentacion`   | texto o `null`  | «6 pzas». `null` si no se ha definido                                     |
| `descripcion`    | texto           | La ficha del producto. **Cadena vacía** si no se ha escrito, nunca `null` |
| `ingredientes`   | lista de textos | Ingredientes destacados, en orden. Lista vacía si no hay                  |
| `precio`         | texto o `null`  | Precio en MXN como texto decimal. **`null` = «Consulta precio»**          |
| `disponibilidad` | texto           | `disponible`, `ultimas_piezas` (5 o menos) o `agotado`                    |
| `imagen`         | objeto o `null` | `url` (1200 px), `urlChica` (600 px) y `alt`. `null` si no tiene foto     |

El precio viaja como texto (`"30.00"`) para que no se pierdan centavos al convertirlo:
conviene mostrarlo tal cual, o convertirlo solo al formatear. Es el precio final al
público, el mismo que cobra el mostrador: no lleva nada encima ni por pagar con tarjeta
—esa comisión la absorbe el negocio— ni por ningún otro concepto.

`descripcion` e `ingredientes` son la ficha del producto, y se capturan en la aplicación.
Los dos pueden venir vacíos (`""` y `[]`): el sitio decide si esconde la sección o pone un
texto de relleno. Los ingredientes llegan en el orden en que se capturaron, que es el orden
en el que conviene mostrarlos.

**Por qué no va la existencia exacta**: con el número, cualquiera que consulte dos veces al
día calcula el ritmo de venta del negocio. Cómo mostrar cada estado («Disponible»,
«Últimas piezas», «Agotado»…) lo decide el sitio.

## Caché y límites

- La respuesta trae `Cache-Control: public, max-age=60, s-maxage=300,
stale-while-revalidate=600`. Conviene dejar que Cloudflare la cachee con una regla de
  caché: así el origen casi no se toca.
- Hay un límite de **60 peticiones por minuto** por IP. El sitio debería leer el catálogo
  al construirse o cada pocos minutos, no en cada visita.
- Las imágenes las sirve `img.unavezmasmx.com` (un bucket de Cloudflare R2 detrás de la
  caché de Cloudflare), no la aplicación, y son inmutables: una foto nueva tiene otra URL,
  así que se pueden cachear para siempre.
- **El sitio no debe fijar ese dominio en su código**: las URLs llegan completas en esta
  respuesta. Si algún día cambia el dominio o el proveedor, el sitio no se entera.

## Qué no se puede ver

Nada más. No hay ruta pública para ventas, costos, márgenes, proveedores, usuarios ni
existencias. Todo lo demás exige pasar por Cloudflare Access y tener permisos en la
aplicación.

## En Cloudflare

La aplicación entera está detrás de Access. Para que esta ruta quede abierta hay que
declararla, de una de estas dos formas:

- **Una aplicación de Access para `gestion.unavezmasmx.com/api/publico/*` con política
  _Bypass_ para todos** (la recomendada: un solo hostname y el resto sigue protegido).
- O un hostname propio del túnel (por ejemplo `datos.unavezmasmx.com`) sin Access. Aunque
  se use, el resto de la API sigue negando sin identidad, porque el guard de la aplicación
  pide el JWT de Access.

## Cambios al contrato

- **Agregar** campos a la respuesta está permitido y no rompe al sitio.
- **Quitar o renombrar** un campo, o cambiar su significado, se coordina antes con quien
  mantiene el back del sitio y se anota aquí.
- Cambiar un `slug` rompe la URL del producto en el sitio: se hace solo a propósito y junto
  con `products.json`.

| Fecha      | Cambio                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| 2026-09-21 | Primera versión: la vista `publico.catalogo` (7 columnas)                                                  |
| 2026-09-22 | Se agregan `id`, `imagen`, `imagen_chica` e `imagen_alt`                                                   |
| 2026-09-23 | El contrato pasa a ser HTTP (`/api/publico/catalogo`), con `disponibilidad` en vez de la existencia exacta |

## La vista `publico.catalogo` (uso interno)

La vista sigue existiendo, con el rol `sitio_lectura`, para herramientas internas o para
una consulta directa desde el propio servidor. **No es la vía del sitio** y no se expone
fuera del servidor. Dos advertencias si se usa:

- `existencia_total` y `existencia_almacen` quedan **obsoletas**: se retiran cuando nadie
  las consulte. En su lugar está la columna `disponibilidad`.
- Los límites del rol (5 s por consulta, 10 conexiones) son una red contra accidentes, no
  un candado: un rol puede levantarse los suyos. Lo que de verdad garantiza que no escriba
  es que no tiene permisos de escritura sobre nada, y hay una prueba que lo verifica
  (`api/test/bd.int-spec.ts`).
- El rol no ve ningún dato del esquema `gestion`, pero sí los **nombres** de tablas y
  columnas a través del catálogo del sistema, que Postgres deja leer siempre.
