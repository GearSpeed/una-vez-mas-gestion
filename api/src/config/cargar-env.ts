import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * En desarrollo carga el `.env` de la raíz del repo (el mismo que usa
 * docker compose). En producción no existe y las variables vienen del entorno.
 * Las variables que ya estén definidas no se sobrescriben.
 */
export function cargarArchivoEnv(): void {
  const archivo = resolve(import.meta.dirname, '../../../.env');
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}
