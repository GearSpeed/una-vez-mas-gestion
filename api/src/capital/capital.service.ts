import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type DatosMovimientoCapital,
  type DatosSocio,
  type ListaCapital,
  METODOS_PAGO,
  type MetodoPago,
  type MovimientoCapital,
  restar,
  type SaldosCaja,
  type Socio,
  sumar,
} from '@uvm/compartido';
import { and, asc, count, desc, eq, gte, lte, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { registrarEnBitacora } from '../comun/bitacora.js';
import { fechaDelDocumento } from '../comun/fechas.js';
import { conIdempotencia } from '../comun/idempotencia.js';
import { type BaseDatos, DB } from '../db/conexion.js';
import {
  compras as comprasTabla,
  devolucionPagos,
  devoluciones as devolucionesTabla,
  gastos as gastosTabla,
  movimientosCapital,
  socios,
  usuarios,
  ventaPagos,
  ventas as ventasTabla,
} from '../db/esquema.js';

const POR_PAGINA = 30;
const registradoPor = alias(usuarios, 'registrado_por');
const canceladoPor = alias(usuarios, 'cancelado_por');

/** Aportaciones menos retiros, de lo vigente. Sirve para un socio o para todos. */
const saldoDeSocio = sql<string>`coalesce(sum(
  case when ${movimientosCapital.estado} = 'vigente'
    then case when ${movimientosCapital.tipo} = 'aportacion'
      then ${movimientosCapital.importe} else -${movimientosCapital.importe} end
    else 0 end
), 0)::numeric(12, 2)`;

/** El importe de esa bolsa, o cero si no hubo movimiento con ese método. */
function buscar(
  filas: readonly { metodoPago: MetodoPago; importe: string }[],
  metodo: MetodoPago,
): string {
  return filas.find((f) => f.metodoPago === metodo)?.importe ?? '0.00';
}

/**
 * El dinero que los socios meten o sacan del negocio.
 *
 * **No es ingreso ni gasto.** Una aportación no es utilidad de nadie: contarla como venta
 * haría ver ganancias que no existen, y es justo el error que este módulo evita. Lo único
 * que mueve es la caja.
 */
@Injectable()
export class CapitalService {
  constructor(@Inject(DB) private readonly db: BaseDatos) {}

  async registrar(
    usuario: UsuarioSesion,
    datos: DatosMovimientoCapital,
  ): Promise<MovimientoCapital> {
    const fecha = fechaDelDocumento(datos.fecha);
    return conIdempotencia(
      () => this.porClave(datos.claveIdempotencia),
      async () => {
        const id = await this.db.transaction(async (tx) => {
          const [socio] = await tx
            .select({ activo: socios.activo })
            .from(socios)
            .where(eq(socios.id, datos.socioId));
          if (!socio?.activo) {
            throw new NotFoundException('Ese socio no existe o está dado de baja.');
          }

          const [movimiento] = await tx
            .insert(movimientosCapital)
            .values({
              fecha,
              socioId: datos.socioId,
              tipo: datos.tipo,
              concepto: datos.concepto,
              importe: datos.importe,
              metodoPago: datos.metodoPago,
              notas: datos.notas,
              usuarioId: usuario.id,
              claveIdempotencia: datos.claveIdempotencia,
            })
            .returning({ id: movimientosCapital.id });
          if (!movimiento) throw new Error('No se registró el movimiento');
          await registrarEnBitacora(tx, {
            usuarioId: usuario.id,
            accion: 'crear',
            entidad: 'capital',
            entidadId: movimiento.id,
            datos: { tipo: datos.tipo, importe: datos.importe },
          });
          return movimiento.id;
        });
        return this.obtener(id);
      },
    );
  }

  /** No se borra: se cancela con motivo y queda a la vista, como todo documento. */
  async cancelar(usuario: UsuarioSesion, id: number, motivo: string): Promise<MovimientoCapital> {
    await this.db.transaction(async (tx) => {
      const [movimiento] = await tx
        .select({ estado: movimientosCapital.estado })
        .from(movimientosCapital)
        .where(eq(movimientosCapital.id, id))
        .for('update');
      if (!movimiento) throw new NotFoundException('El movimiento no existe.');
      if (movimiento.estado === 'cancelado') {
        throw new ConflictException('El movimiento ya estaba cancelado.');
      }

      await tx
        .update(movimientosCapital)
        .set({
          estado: 'cancelado',
          canceladoEn: new Date(),
          canceladoPor: usuario.id,
          motivoCancelacion: motivo,
        })
        .where(eq(movimientosCapital.id, id));
      await registrarEnBitacora(tx, {
        usuarioId: usuario.id,
        accion: 'cancelar',
        entidad: 'capital',
        entidadId: id,
        datos: { motivo },
      });
    });
    return this.obtener(id);
  }

  async listar(filtro: {
    desde?: string;
    hasta?: string;
    socioId?: number;
    pagina: number;
  }): Promise<ListaCapital> {
    const condiciones: SQL[] = [];
    if (filtro.desde) condiciones.push(gte(movimientosCapital.fecha, filtro.desde));
    if (filtro.hasta) condiciones.push(lte(movimientosCapital.fecha, filtro.hasta));
    if (filtro.socioId) condiciones.push(eq(movimientosCapital.socioId, filtro.socioId));
    const donde = condiciones.length > 0 ? and(...condiciones) : undefined;
    const vigentes = and(...condiciones, eq(movimientosCapital.estado, 'vigente'));

    const [filas, [conteo], porTipo, porSocio] = await Promise.all([
      this.consulta()
        .where(donde)
        .orderBy(desc(movimientosCapital.fecha), desc(movimientosCapital.id))
        .limit(POR_PAGINA)
        .offset((filtro.pagina - 1) * POR_PAGINA),
      this.db.select({ total: count() }).from(movimientosCapital).where(donde),
      this.db
        .select({
          tipo: movimientosCapital.tipo,
          importe: sql<string>`coalesce(sum(${movimientosCapital.importe}), 0)::numeric(12, 2)`,
        })
        .from(movimientosCapital)
        .where(vigentes)
        .groupBy(movimientosCapital.tipo),
      // El saldo de cada socio va desde siempre, no del periodo: es cuánto lleva puesto.
      this.db
        .select({ socio: socios.nombre, saldo: saldoDeSocio })
        .from(socios)
        .leftJoin(movimientosCapital, eq(movimientosCapital.socioId, socios.id))
        .groupBy(socios.id, socios.nombre)
        .orderBy(asc(socios.nombre)),
    ]);

    const aportaciones = porTipo.find((f) => f.tipo === 'aportacion')?.importe ?? '0.00';
    const retiros = porTipo.find((f) => f.tipo === 'retiro')?.importe ?? '0.00';

    return {
      filas: filas.map((fila) => this.aMovimiento(fila)),
      total: conteo?.total ?? 0,
      pagina: filtro.pagina,
      porPagina: POR_PAGINA,
      resumen: { aportaciones, retiros, neto: restar(aportaciones, retiros) },
      porSocio,
    };
  }

  async obtener(id: number): Promise<MovimientoCapital> {
    const [fila] = await this.consulta().where(eq(movimientosCapital.id, id));
    if (!fila) throw new NotFoundException('El movimiento no existe.');
    return this.aMovimiento(fila);
  }

  /**
   * Cuánto dinero debería haber, acumulado desde siempre y separado por dónde está.
   *
   * Tres bolsas distintas: el efectivo que traes, lo que sigue en Mercado Pago y lo del
   * banco. Juntarlas daría un número que no cuadra con nada que puedas contar.
   *
   * Lo de tarjeta va **neto de comisión**, que es lo que de verdad cae; y cuando hay una
   * devolución, la terminal regresa parte de lo que retuvo, así que ese reembolso vuelve
   * a esa misma bolsa.
   *
   * **No es utilidad.** Puede haber mucho dinero aquí y el negocio estar perdiendo, si ese
   * dinero lo pusieron los socios. Para saber si se gana está el Resultado del periodo.
   */
  async saldos(): Promise<SaldosCaja> {
    const [ventas, devoluciones, comisionDevuelta, compras, gastosPorMetodo, capital] =
      await Promise.all([
        this.db
          .select({
            metodoPago: ventaPagos.metodoPago,
            importe: sql<string>`coalesce(sum(${ventaPagos.importe} - ${ventaPagos.comision}), 0)::numeric(12, 2)`,
          })
          .from(ventaPagos)
          .innerJoin(ventasTabla, eq(ventasTabla.id, ventaPagos.ventaId))
          .where(eq(ventasTabla.estado, 'vigente'))
          .groupBy(ventaPagos.metodoPago),
        this.db
          .select({
            metodoPago: devolucionPagos.metodoPago,
            importe: sql<string>`coalesce(sum(${devolucionPagos.importe}), 0)::numeric(12, 2)`,
          })
          .from(devolucionPagos)
          .groupBy(devolucionPagos.metodoPago),
        // La terminal regresa parte de lo que retuvo: solo puede ser de tarjeta.
        this.db
          .select({
            importe: sql<string>`coalesce(sum(${devolucionesTabla.comisionDevuelta}), 0)::numeric(12, 2)`,
          })
          .from(devolucionesTabla),
        this.db
          .select({
            metodoPago: comprasTabla.metodoPago,
            importe: sql<string>`coalesce(sum(${comprasTabla.total}), 0)::numeric(12, 2)`,
          })
          .from(comprasTabla)
          .where(eq(comprasTabla.estado, 'vigente'))
          .groupBy(comprasTabla.metodoPago),
        this.db
          .select({
            metodoPago: gastosTabla.metodoPago,
            importe: sql<string>`coalesce(sum(${gastosTabla.importe}), 0)::numeric(12, 2)`,
          })
          .from(gastosTabla)
          .where(eq(gastosTabla.estado, 'vigente'))
          .groupBy(gastosTabla.metodoPago),
        this.db
          .select({
            metodoPago: movimientosCapital.metodoPago,
            tipo: movimientosCapital.tipo,
            importe: sql<string>`coalesce(sum(${movimientosCapital.importe}), 0)::numeric(12, 2)`,
          })
          .from(movimientosCapital)
          .where(eq(movimientosCapital.estado, 'vigente'))
          .groupBy(movimientosCapital.metodoPago, movimientosCapital.tipo),
      ]);

    const bolsas = METODOS_PAGO.map((metodoPago) => {
      const ventasNetas = buscar(ventas, metodoPago);
      // El reembolso de comisión solo existe en tarjeta, así que solo baja ahí.
      const devueltoNeto =
        metodoPago === 'tarjeta'
          ? restar(buscar(devoluciones, metodoPago), comisionDevuelta[0]?.importe ?? '0.00')
          : buscar(devoluciones, metodoPago);
      const comprado = buscar(compras, metodoPago);
      const gastado = buscar(gastosPorMetodo, metodoPago);
      const aportado = buscar(
        capital.filter((f) => f.tipo === 'aportacion'),
        metodoPago,
      );
      const retirado = buscar(
        capital.filter((f) => f.tipo === 'retiro'),
        metodoPago,
      );

      return {
        metodoPago,
        ventas: ventasNetas,
        devoluciones: devueltoNeto,
        compras: comprado,
        gastos: gastado,
        aportaciones: aportado,
        retiros: retirado,
        saldo: restar(
          sumar([ventasNetas, aportado]),
          sumar([devueltoNeto, comprado, gastado, retirado]),
        ),
      };
    });

    return { bolsas, total: sumar(bolsas.map((b) => b.saldo)) };
  }

  /* ---- socios ---- */

  async socios(): Promise<Socio[]> {
    return this.db
      .select({
        id: socios.id,
        nombre: socios.nombre,
        activo: socios.activo,
        saldo: saldoDeSocio,
      })
      .from(socios)
      .leftJoin(movimientosCapital, eq(movimientosCapital.socioId, socios.id))
      .groupBy(socios.id, socios.nombre, socios.activo)
      .orderBy(asc(socios.nombre));
  }

  async crearSocio(datos: DatosSocio): Promise<Socio> {
    const [creado] = await this.db.insert(socios).values(datos).returning({ id: socios.id });
    if (!creado) throw new Error('No se creó el socio');
    return this.obtenerSocio(creado.id);
  }

  async actualizarSocio(id: number, datos: DatosSocio): Promise<Socio> {
    const [actualizado] = await this.db
      .update(socios)
      .set(datos)
      .where(eq(socios.id, id))
      .returning({ id: socios.id });
    if (!actualizado) throw new NotFoundException('El socio no existe.');
    return this.obtenerSocio(actualizado.id);
  }

  private async obtenerSocio(id: number): Promise<Socio> {
    const todos = await this.socios();
    const socio = todos.find((s) => s.id === id);
    if (!socio) throw new NotFoundException('El socio no existe.');
    return socio;
  }

  /* ---- internos ---- */

  private consulta() {
    return this.db
      .select({
        id: movimientosCapital.id,
        folio: movimientosCapital.folio,
        fecha: movimientosCapital.fecha,
        socioId: movimientosCapital.socioId,
        socio: socios.nombre,
        tipo: movimientosCapital.tipo,
        concepto: movimientosCapital.concepto,
        importe: movimientosCapital.importe,
        metodoPago: movimientosCapital.metodoPago,
        notas: movimientosCapital.notas,
        registradoPor: registradoPor.nombre,
        registradoEn: movimientosCapital.registradoEn,
        estado: movimientosCapital.estado,
        canceladoEn: movimientosCapital.canceladoEn,
        canceladoPor: canceladoPor.nombre,
        motivoCancelacion: movimientosCapital.motivoCancelacion,
      })
      .from(movimientosCapital)
      .innerJoin(socios, eq(socios.id, movimientosCapital.socioId))
      .innerJoin(registradoPor, eq(registradoPor.id, movimientosCapital.usuarioId))
      .leftJoin(canceladoPor, eq(canceladoPor.id, movimientosCapital.canceladoPor))
      .$dynamic();
  }

  private aMovimiento({
    canceladoEn,
    canceladoPor: por,
    motivoCancelacion,
    registradoEn,
    ...fila
  }: Awaited<ReturnType<CapitalService['consulta']>>[number]): MovimientoCapital {
    return {
      ...fila,
      registradoEn: registradoEn.toISOString(),
      cancelacion: canceladoEn
        ? { en: canceladoEn.toISOString(), por: por ?? '', motivo: motivoCancelacion ?? '' }
        : null,
    };
  }

  private async porClave(clave: string): Promise<MovimientoCapital | null> {
    const [fila] = await this.db
      .select({ id: movimientosCapital.id })
      .from(movimientosCapital)
      .where(eq(movimientosCapital.claveIdempotencia, clave));
    return fila ? this.obtener(fila.id) : null;
  }
}
