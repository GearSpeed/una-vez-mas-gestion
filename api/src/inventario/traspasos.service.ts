import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { NuevoTraspaso, TraspasoDetalle } from '@uvm/compartido';
import { and, desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { fechaDelDocumento } from '../comun/fechas.js';
import { conIdempotencia } from '../comun/idempotencia.js';
import { type BaseDatos, DB } from '../db/conexion.js';
import { productos, traspasoDetalle, traspasos, ubicaciones, usuarios } from '../db/esquema.js';
import { MovimientosService } from './movimientos.service.js';

const origen = alias(ubicaciones, 'origen');
const destino = alias(ubicaciones, 'destino');

/**
 * Un traspaso mueve piezas entre ubicaciones: cargar mercancía a un vendedor o
 * recibir lo que regresa. No cambia el costo. No se cancela: se corrige con el
 * traspaso contrario.
 */
@Injectable()
export class TraspasosService {
  constructor(
    @Inject(DB) private readonly db: BaseDatos,
    private readonly movimientos: MovimientosService,
  ) {}

  async registrar(usuario: UsuarioSesion, datos: NuevoTraspaso): Promise<TraspasoDetalle> {
    const fecha = fechaDelDocumento(datos.fecha);
    return conIdempotencia(
      () => this.porClave(datos.claveIdempotencia, usuario.id),
      async () => {
        const id = await this.db.transaction(async (tx) => {
          const [traspaso] = await tx
            .insert(traspasos)
            .values({
              fecha,
              origenId: datos.origenId,
              destinoId: datos.destinoId,
              notas: datos.notas,
              usuarioId: usuario.id,
              claveIdempotencia: datos.claveIdempotencia,
            })
            .returning({ id: traspasos.id });
          if (!traspaso) throw new Error('No se registró el traspaso');

          await tx
            .insert(traspasoDetalle)
            .values(datos.lineas.map((linea) => ({ traspasoId: traspaso.id, ...linea })));
          await this.movimientos.aplicar(
            tx,
            [
              ...datos.lineas.map((linea) => ({
                productoId: linea.productoId,
                ubicacionId: datos.origenId,
                cantidad: -linea.cantidad,
                tipo: 'traspaso_salida' as const,
              })),
              ...datos.lineas.map((linea) => ({
                productoId: linea.productoId,
                ubicacionId: datos.destinoId,
                cantidad: linea.cantidad,
                tipo: 'traspaso_entrada' as const,
              })),
            ],
            { referencia: { traspasoId: traspaso.id }, usuarioId: usuario.id, fecha },
          );
          return traspaso.id;
        });
        return this.detalle(id);
      },
    );
  }

  async recientes(limite = 30): Promise<TraspasoDetalle[]> {
    const filas = await this.db
      .select({ id: traspasos.id })
      .from(traspasos)
      .orderBy(desc(traspasos.id))
      .limit(limite);
    return Promise.all(filas.map((fila) => this.detalle(fila.id)));
  }

  async detalle(id: number): Promise<TraspasoDetalle> {
    const [traspaso] = await this.db
      .select({
        id: traspasos.id,
        folio: traspasos.folio,
        fecha: traspasos.fecha,
        origen: origen.nombre,
        destino: destino.nombre,
        registradoPor: usuarios.nombre,
        notas: traspasos.notas,
      })
      .from(traspasos)
      .innerJoin(origen, eq(origen.id, traspasos.origenId))
      .innerJoin(destino, eq(destino.id, traspasos.destinoId))
      .innerJoin(usuarios, eq(usuarios.id, traspasos.usuarioId))
      .where(eq(traspasos.id, id));
    if (!traspaso) throw new NotFoundException('El traspaso no existe.');

    const lineas = await this.db
      .select({
        productoId: traspasoDetalle.productoId,
        producto: productos.nombre,
        cantidad: traspasoDetalle.cantidad,
      })
      .from(traspasoDetalle)
      .innerJoin(productos, eq(productos.id, traspasoDetalle.productoId))
      .where(eq(traspasoDetalle.traspasoId, id))
      .orderBy(productos.nombre);
    return { ...traspaso, lineas };
  }

  private async porClave(
    claveIdempotencia: string,
    usuarioId: number,
  ): Promise<TraspasoDetalle | null> {
    const [fila] = await this.db
      .select({ id: traspasos.id })
      .from(traspasos)
      .where(
        and(eq(traspasos.claveIdempotencia, claveIdempotencia), eq(traspasos.usuarioId, usuarioId)),
      );
    return fila ? this.detalle(fila.id) : null;
  }
}
