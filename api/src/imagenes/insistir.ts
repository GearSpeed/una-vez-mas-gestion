/** Cuánto se insiste cuando el almacén todavía no contesta, y cuánto se espera entre intentos. */
const INTENTOS = 10;
const ESPERA_MS = 1000;

/**
 * Repite mientras el almacén esté arrancando o se caiga la conexión. MinIO acepta
 * conexiones antes de poder atenderlas: contesta a su chequeo de salud, pero corta
 * la primera petición («ClientDisconnected») hasta que termina de montar el disco. Y
 * tanto MinIO como R2 cierran de vez en cuando una conexión reutilizada, que es el
 * tropiezo que hacía parpadear las pruebas de imágenes.
 */
export async function insistiendo<T>(tarea: () => Promise<T>): Promise<T> {
  for (let intento = 1; ; intento++) {
    try {
      return await tarea();
    } catch (error) {
      if (intento >= INTENTOS || !esPasajero(error)) throw error;
      await new Promise((listo) => setTimeout(listo, ESPERA_MS));
    }
  }
}

/**
 * Errores de «todavía no estoy listo»: la conexión se cae o el servidor la corta.
 *
 * Los `UND_ERR_*` son los del `fetch` de Node (undici), que es con lo que se leen los
 * objetos sin credenciales: ahí una conexión reutilizada que el servidor cerró no
 * llega como `ECONNRESET` sino como su propio error de socket.
 */
function esPasajero(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const codigo = (error as { Code?: string }).Code;
  const sistema = (error.cause as { code?: string } | undefined)?.code;
  return (
    codigo === 'ClientDisconnected' ||
    codigo === 'ServerBusy' ||
    codigo === 'SlowDown' ||
    error.name === 'TimeoutError' ||
    sistema === 'ECONNREFUSED' ||
    sistema === 'ECONNRESET' ||
    sistema === 'EPIPE' ||
    sistema === 'UND_ERR_SOCKET' ||
    sistema === 'UND_ERR_CONNECT_TIMEOUT'
  );
}
