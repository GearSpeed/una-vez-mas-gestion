/**
 * Clave de idempotencia de un formulario: la misma mientras no se registre, así
 * un doble toque o un reintento no duplican el documento.
 */
export function nuevaClave(): string {
  return crypto.randomUUID();
}

/** Número de un campo de formulario, o null si está vacío. */
export function numeroONulo(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}
