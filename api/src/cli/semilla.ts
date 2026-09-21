/**
 * `npm run semilla`: roles, categorías, los 13 productos, el Almacén y el admin
 * inicial (ADMIN_INICIAL_CORREO). `npm run semilla -- --demo` agrega usuarios,
 * proveedor y vehículo de prueba: solo para desarrollo.
 */
import { cargarArchivoEnv } from '../config/cargar-env.js';
import { crearBaseDatos } from '../db/conexion.js';
import { sembrar } from '../db/semilla.js';

cargarArchivoEnv();
const url = process.env['DATABASE_URL_MIGRACIONES'];
if (!url) {
  console.error('Falta DATABASE_URL_MIGRACIONES (la conexión de gestion_owner).');
  process.exit(1);
}

const demo = process.argv.includes('--demo');
if (demo && process.env['NODE_ENV'] === 'production') {
  console.error('--demo no se permite en producción.');
  process.exit(1);
}

const correo = process.env['ADMIN_INICIAL_CORREO'];
const nombre = process.env['ADMIN_INICIAL_NOMBRE'] ?? 'Administrador';
if (!correo) console.warn('Sin ADMIN_INICIAL_CORREO: no se crea el administrador inicial.');

const db = crearBaseDatos(url, { maximo: 1 });
try {
  await sembrar(db, { admin: correo ? { correo, nombre } : undefined, demo });
  console.log(`Semilla aplicada${demo ? ' (con datos de prueba)' : ''}.`);
} finally {
  await db.$client.end();
}
