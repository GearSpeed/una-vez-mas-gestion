import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export const CARPETA_MIGRACIONES = resolve(import.meta.dirname, '../../drizzle');

/**
 * Aplica las migraciones pendientes de `drizzle/`. Corre como gestion_owner, el
 * dueño del esquema: la API (gestion_app) no puede crear ni alterar tablas.
 */
export async function migrar(url: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: CARPETA_MIGRACIONES,
      migrationsSchema: 'drizzle',
    });
  } finally {
    await pool.end();
  }
}
