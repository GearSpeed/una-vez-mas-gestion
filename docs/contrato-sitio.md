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

Sin identidad, sin llaves, sin cabeceras especiales. Responde un objeto con dos partes:
las **categorías activas**, en el orden en que se muestran, y una entrada por producto
**activo y publicado**, ordenado por categoría y nombre:

```json
{
  "categorias": [
    {
      "nombre": "Galletas",
      "vitrina": {
        "titulo": "Galletas de Amaranto",
        "insignia": "Tradición dulce",
        "icono": "cookie",
        "descripcion": "Todas llevan amaranto: avena, chocolate, coco y nuez.",
        "cta": "Ver nuestras galletas",
        "imagen": null
      }
    },
    { "nombre": "Obleas", "vitrina": null }
  ],
  "productos": [
    {
      "slug": "galletas-avena",
      "nombre": "Galletas de Avena",
      "categoria": "Galletas",
      "presentacion": "6 pzas",
      "resumen": "Avena y amaranto con un toque de canela, ligeras y crujientes.",
      "descripcion": "Galletas suaves de avena con amaranto, recién hechas.",
      "ingredientes": ["avena", "amaranto", "miel de agave"],
      "precio": "30.00",
      "disponibilidad": "disponible",
      "imagen": {
        "url": "https://img.unavezmasmx.com/productos/1/3f9a1c2b7d8e6f50-1200.webp",
        "urlChica": "https://img.unavezmasmx.com/productos/1/3f9a1c2b7d8e6f50-600.webp",
        "alt": "Galletas de avena con amaranto sobre un plato de barro",
        "esPlaceholder": false
      }
    }
  ]
}
```

**`categorias` no se deduce de los productos.** Una categoría recién dada de alta todavía
no tiene ninguno, y aun así debe poder anunciarse en el sitio («Próximamente»). Vienen
solo las activas, en el orden en que se capturó que se muestran; una dada de baja
desaparece de la lista. Cada `producto.categoria` es el `nombre` de una de estas.

**`vitrina` es su tarjeta** en «Nuestras Categorías Dulces», la fila de la portada. Llega
`null` cuando la categoría no tiene con qué armarla, y entonces simplemente no se anuncia;
sigue en la lista, porque sirve para filtrar el catálogo. Hay tarjeta cuando se cumplen las
dos cosas:

1. **Tiene `descripcion`.** Es lo que la enciende: el único texto que no se puede deducir de
   nada.
2. **Hay de dónde sacar la imagen**: su foto propia, o al menos un producto publicado con
   foto propia (uno con el logo de relleno no cuenta).

**`vitrina.imagen` casi siempre llega `null`, y eso no es un error: significa «sácala de sus
productos».** Lo normal es que la tarjeta se vista con las fotos de su familia, y como el
sitio sortea una en el navegador, la portada cambia un poco en cada visita. Cuando sí viene
una imagen es porque alguien le subió una foto propia a la categoría para dejarla fija.

Conviene sortear **sólo entre los productos de esa categoría cuya `imagen.esPlaceholder`
sea `false`**, y tomar el `alt` del producto elegido, que ya está escrito.

`titulo` y `cta` vienen resueltos: si no se capturaron, traen el nombre de la categoría y
«Ver {nombre}». `insignia` e `icono` pueden venir vacíos, y entonces no se pintan; el ícono
es un nombre de Material Symbols. El **color** de cada tarjeta no viaja: lo decide el sitio
según el lugar que ocupa en la fila.

Los campos de cada producto:

| Campo            | Tipo            | Qué es                                                                                   |
| ---------------- | --------------- | ---------------------------------------------------------------------------------------- |
| `slug`           | texto           | La llave con el sitio: es el `id` de `products.json` y `/catalogo/:slug`                 |
| `nombre`         | texto           | Nombre del producto                                                                      |
| `categoria`      | texto           | «Galletas», «Borrachitos», «Alegrías»…                                                   |
| `presentacion`   | texto o `null`  | «6 pzas». `null` si no se ha definido                                                    |
| `resumen`        | texto           | Una o dos líneas para la tarjeta. **Cadena vacía** si no se ha escrito                   |
| `descripcion`    | texto           | La ficha del producto. **Cadena vacía** si no se ha escrito, nunca `null`                |
| `ingredientes`   | lista de textos | Ingredientes destacados, en orden. Lista vacía si no hay                                 |
| `precio`         | texto o `null`  | Precio en MXN como texto decimal, siempre mayor que cero. **`null` = «Consulta precio»** |
| `disponibilidad` | texto           | `disponible`, `ultimas_piezas` (5 o menos) o `agotado`                                   |
| `imagen`         | objeto          | `url` (1200 px), `urlChica` (600 px), `alt` y `esPlaceholder`. **Nunca `null`**          |
| `destacado`      | objeto o `null` | Los textos de su tarjeta de portada. `null` si no está en «Los Favoritos»                |

El precio viaja como texto (`"30.00"`) para que no se pierdan centavos al convertirlo:
conviene mostrarlo tal cual, o convertirlo solo al formatear. Es el precio final al
público, el mismo que cobra el mostrador: no lleva nada encima ni por pagar con tarjeta
—esa comisión la absorbe el negocio— ni por ningún otro concepto.

**Nunca llega un precio en cero.** Un producto en $0 es una captura a medias o un dedazo,
y publicarlo obligaría a respetar ese precio ante quien lo viera. La API lo convierte en
`null`, que es «Consulta precio». Aun así, conviene que el sitio no pinte un cero aunque
le llegue: puede estar mostrando una copia de otro momento.

`resumen`, `descripcion` e `ingredientes` son la ficha del producto, y se capturan en la
aplicación: el resumen es el gancho de la tarjeta y la descripción el párrafo del detalle.
Los tres pueden venir vacíos (`""`, `""` y `[]`): el sitio decide si esconde la sección o
pone un texto de relleno. Los ingredientes llegan en el orden en que se capturaron, que es el orden
en el que conviene mostrarlos.

**`imagen` nunca viene vacía.** Si el producto todavía no tiene foto, llega el logo de la
marca con **`esPlaceholder: true`**, servido por el mismo dominio de imágenes. Así el sitio
no tiene que resolver el hueco, pero sabe que no es una foto del producto: conviene no
indexarla como tal, no abrirla en la galería y, si se muestra, dejarla como decorativa
(`alt=""`). Con foto propia, `esPlaceholder` es `false` y el `alt` es el que escribió quien
la subió.

**`destacado` es la sección «Los Favoritos de la Casa»** de la portada, y trae solo lo que
hay que escribir: `etiqueta` (la píldora: «Clásico», «Para el café»), `quip` (el guiño
junto a la estrellita) y `texto`. El nombre, la foto, el precio y la disponibilidad de esa
tarjeta salen del propio producto, para que no puedan contradecirse con el catálogo.
`texto` viene resuelto: si no se capturó, trae el `resumen`.

Vienen como mucho **cuatro**, que es la fila que dibuja el sitio, y siempre publicados. El
orden es el mismo de la respuesta.

**Por qué no va la existencia exacta**: con el número, cualquiera que consulte dos veces al
día calcula el ritmo de venta del negocio. Cómo mostrar cada estado («Disponible»,
«Últimas piezas», «Agotado»…) lo decide el sitio.

## Caché y límites

- La respuesta trae `Cache-Control: public, max-age=60, s-maxage=300,
stale-while-revalidate=600`. Conviene dejar que Cloudflare la cachee con una regla de
  caché: así el origen casi no se toca.
- Hay un límite de **60 peticiones por minuto** por IP. El sitio debería leer el catálogo
  al construirse o cada pocos minutos, no en cada visita.
- La respuesta trae `Access-Control-Allow-Origin: *`, así que el **navegador** del sitio
  puede leerla directo, desde cualquier dominio. Es una cabecera fija a propósito:
  Cloudflare no varía la caché por `Origin`, y una que cambiara según quién pregunta se
  quedaría pegada en la caché con el valor del primero. `*` además impide que el navegador
  mande cookies, que es lo que se quiere: aquí no hay identidad. Es la única ruta de la API
  con CORS.
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
| 2026-09-25 | Se agregan `descripcion` e `ingredientes`; `imagen` deja de ser `null` y trae `esPlaceholder`              |
| 2026-09-28 | Se agrega `resumen` y la cabecera `Access-Control-Allow-Origin: *`; el sitio pasa a leer esta ruta         |
| 2026-09-28 | Un `precio` en cero sale como `null`: nunca se publica un producto en $0                                   |
| 2026-09-28 | **Cambio que rompe**: la respuesta pasa de ser un arreglo a `{ categorias, productos }`                    |
| 2026-09-28 | Se agrega `destacado`: quién sale en «Los Favoritos de la Casa» se elige en la aplicación                  |
| 2026-09-29 | **Cambio que rompe**: `categorias` pasa de nombres a objetos, cada uno con su `vitrina`                    |
| 2026-09-29 | La tarjeta se enciende con la `descripcion`, y su `imagen` llega `null` cuando sale de los productos       |

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
