import { sql } from 'drizzle-orm';
import { devoluciones, ventaPagos, ventas } from './esquema.js';

/** Lo que se le ha regresado al cliente de una venta (0 si no hubo devoluciones). */
export const reembolsadoDeVenta = sql<string>`coalesce((select sum(d.reembolso) from ${devoluciones} d
  where d.venta_id = ${ventas.id}), 0)`;

/**
 * Lo que la entidad del cobro con tarjeta se quedó de una venta: la comisión que
 * retuvo menos lo que regresó en devoluciones.
 */
export const comisionNetaDeVenta = sql<string>`(${ventas.comision} - coalesce((select
  sum(d.comision_devuelta) from ${devoluciones} d where d.venta_id = ${ventas.id}), 0))`;

/**
 * Cómo se pagó una venta, en una palabra: su método si fue uno solo, o `mixto` si
 * el cliente repartió el pago. Para agrupar en reportes, donde lo que se compara es
 * el tipo de venta; el dinero por método sale de `venta_pagos`, no de aquí.
 */
export const formaDePagoDeVenta = sql<string>`(select
  case when count(*) > 1 then 'mixto' else coalesce(min(p.metodo_pago::text), 'sin pago') end
  from ${ventaPagos} p where p.venta_id = ${ventas.id})`;
