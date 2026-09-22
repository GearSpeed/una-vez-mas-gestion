/**
 * Si un producto coincide con lo que se busca. Un número busca también por ID
 * (el que llevará el código de barras): «12» encuentra el producto 12.
 */
export function coincideBusqueda(busqueda: string, id: number, texto: string): boolean {
  const q = normalizar(busqueda);
  if (!q) return true;
  if (/^\d+$/.test(q) && Number(q) === id) return true;
  return normalizar(texto).includes(q);
}

/**
 * Quita acentos y pasa a minúsculas, para que "alegrias" encuentre "Alegrías".
 * Es la misma función del catálogo del sitio (`core/services/catalog.ts`).
 */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * Slug de un producto a partir de su nombre: es la llave con el sitio
 * (`/catalogo/:slug`). "Galletas de Mermelada de Piña" → "galletas-de-mermelada-de-pina".
 * Se genera una sola vez, al crear el producto; después no cambia.
 */
export function slugDe(nombre: string): string {
  return normalizar(nombre)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

/** Folio legible de un documento: `V-000042`. Sale del id, nunca de la fila. */
export function folio(prefijo: 'C' | 'V' | 'T' | 'A' | 'D', id: number): string {
  return `${prefijo}-${String(id).padStart(6, '0')}`;
}
