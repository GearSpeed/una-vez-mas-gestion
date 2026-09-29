import { sql } from 'drizzle-orm';
import { categorias, productos } from '../db/esquema.js';

/**
 * Cuándo una categoría dibuja su tarjeta en «Nuestras Categorías Dulces», la fila de la
 * portada del sitio. Dos condiciones:
 *
 * 1. **Tiene descripción.** Es lo que enciende la tarjeta: el único texto que no se puede
 *    deducir de nada, y sin él la tarjeta se vería a medio llenar.
 * 2. **Hay de dónde sacar la imagen**: su propia foto —que manda, cuando se sube— o al
 *    menos un producto publicado con foto propia, de los que la tarjeta sortea una.
 *    Un producto sin foto no cuenta: ese sirve el logo de relleno, y un logo no es la
 *    cara de una familia.
 *
 * Vive aquí, en un solo lugar, porque la usan los dos lados: el catálogo público para
 * decidir si manda la vitrina, y la pantalla de Productos para su píldora «En portada».
 * Cuando estuvo escrita dos veces, se desalinearon.
 */
export const saleEnPortada = sql<boolean>`(
  ${categorias.descripcion} <> ''
  and (
    ${categorias.imagenClave} is not null
    or exists (
      select 1 from ${productos} p
      where p.categoria_id = ${categorias.id}
        and p.activo and p.publicado and p.imagen_clave is not null
    )
  )
)`;
