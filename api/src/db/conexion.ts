import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as esquema from './esquema.js';

// count() y sum() de enteros llegan como int8: aquí caben de sobra en un número.
pg.types.setTypeParser(pg.types.builtins.INT8, (valor) => Number.parseInt(valor, 10));
// Una fecha se queda como texto ("2026-09-21"): convertirla a Date la movería de día.
pg.types.setTypeParser(pg.types.builtins.DATE, (valor) => valor);
// numeric se queda como texto ("17.909375") para no perder centavos.

export type BaseDatos = NodePgDatabase<typeof esquema> & { $client: pg.Pool };
export type Transaccion = Parameters<Parameters<BaseDatos['transaction']>[0]>[0];
/** Algo contra lo que se puede consultar: la BD o una transacción abierta. */
export type Ejecutor = BaseDatos | Transaccion;

export const DB = Symbol('DB');

export function crearBaseDatos(url: string, { maximo = 10 } = {}): BaseDatos {
  const pool = new pg.Pool({ connectionString: url, max: maximo });
  return drizzle({ client: pool, schema: esquema, casing: 'snake_case' });
}
