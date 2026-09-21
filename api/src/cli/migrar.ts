/** `npm run migrar`: aplica las migraciones pendientes como gestion_owner. */
import { cargarArchivoEnv } from '../config/cargar-env.js';
import { migrar } from '../db/migrar.js';

cargarArchivoEnv();
const url = process.env['DATABASE_URL_MIGRACIONES'];
if (!url) {
  console.error('Falta DATABASE_URL_MIGRACIONES (la conexión de gestion_owner).');
  process.exit(1);
}
await migrar(url);
console.log('Migraciones al día.');
