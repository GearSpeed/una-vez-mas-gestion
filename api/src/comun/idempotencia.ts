import { esViolacionUnica } from './errores-postgres.js';

/**
 * Si el documento con esa clave ya existe (un doble toque, un reintento por mala
 * señal), devuelve el que ya estaba en lugar de registrar otro. Si dos
 * peticiones iguales llegan juntas, la BD deja pasar solo una y la otra
 * devuelve la primera.
 */
export async function conIdempotencia<T>(
  buscar: () => Promise<T | null>,
  crear: () => Promise<T>,
): Promise<T> {
  const previo = await buscar();
  if (previo !== null) return previo;
  try {
    return await crear();
  } catch (error) {
    if (esViolacionUnica(error, 'clave_idempotencia')) {
      const ganador = await buscar();
      if (ganador !== null) return ganador;
    }
    throw error;
  }
}
