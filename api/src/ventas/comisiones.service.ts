import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type ComisionPago,
  type DatosComision,
  type MetodoPago,
  tasaEfectiva,
  type TasaComision,
} from '@uvm/compartido';
import { asc, eq } from 'drizzle-orm';
import { type BaseDatos, DB, type Ejecutor } from '../db/conexion.js';
import { comisionesPago } from '../db/esquema.js';

/**
 * Lo que retiene la entidad por cobrar con cada método de pago. Hoy solo
 * tarjeta (Mercado Pago, 3.50 % + IVA); si una tarifa cambia, el administrador
 * la actualiza y aplica a las ventas nuevas: las ya registradas conservan la suya.
 */
@Injectable()
export class ComisionesService {
  constructor(@Inject(DB) private readonly db: BaseDatos) {}

  async listar(): Promise<ComisionPago[]> {
    const filas = await this.db
      .select()
      .from(comisionesPago)
      .orderBy(asc(comisionesPago.metodoPago));
    return filas.map((fila) => ({
      metodoPago: fila.metodoPago,
      tasa: fila.tasa,
      iva: fila.iva,
      tasaEfectiva: tasaEfectiva(fila),
    }));
  }

  /** La tasa vigente de un método, o null si ese método no paga comisión. */
  async tasaDe(db: Ejecutor, metodo: MetodoPago): Promise<TasaComision | null> {
    const [fila] = await db
      .select({ tasa: comisionesPago.tasa, iva: comisionesPago.iva })
      .from(comisionesPago)
      .where(eq(comisionesPago.metodoPago, metodo));
    return fila ?? null;
  }

  async actualizar(metodo: MetodoPago, datos: DatosComision): Promise<ComisionPago> {
    const [fila] = await this.db
      .update(comisionesPago)
      .set({ tasa: datos.tasa, iva: datos.iva, actualizadoEn: new Date() })
      .where(eq(comisionesPago.metodoPago, metodo))
      .returning();
    if (!fila) throw new NotFoundException('Ese método de pago no tiene comisión configurada.');
    return {
      metodoPago: fila.metodoPago,
      tasa: fila.tasa,
      iva: fila.iva,
      tasaEfectiva: tasaEfectiva(fila),
    };
  }
}
