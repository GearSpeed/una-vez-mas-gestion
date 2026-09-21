import { sql } from 'drizzle-orm';
import { devoluciones, ventas } from './esquema.js';

/** Lo que se le ha regresado al cliente de una venta (0 si no hubo devoluciones). */
export const reembolsadoDeVenta = sql<string>`coalesce((select sum(d.reembolso) from ${devoluciones} d
  where d.venta_id = ${ventas.id}), 0)`;
