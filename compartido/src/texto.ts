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

/** Folio legible de un documento: `V-000042`. Sale del id, nunca de la fila. */
export function folio(prefijo: 'C' | 'V' | 'T' | 'A', id: number): string {
  return `${prefijo}-${String(id).padStart(6, '0')}`;
}
