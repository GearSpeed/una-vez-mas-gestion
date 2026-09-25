import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type Categoria,
  type DatosCategoria,
  type DatosGasto,
  type FiltroGastos,
  type Gasto,
  type ListaGastos,
  sumar,
} from '@uvm/compartido';
import { and, asc, count, desc, eq, gte, lte, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { registrarEnBitacora } from '../comun/bitacora.js';
import { fechaDelDocumento } from '../comun/fechas.js';
import { conIdempotencia } from '../comun/idempotencia.js';
import { type BaseDatos, DB } from '../db/conexion.js';
import { gastoCategorias, gastos, usuarios } from '../db/esquema.js';

const POR_PAGINA = 30;
const canceladoPor = alias(usuarios, 'cancelado_por');
const registradoPor = alias(usuarios, 'registrado_por');

/**
 * Lo que cuesta operar y no es mercancía: bolsas, renta, publicidad, el pago de una
 * comisión. La mercancía entra por `compras`, con su costo y su gasolina; aquí va
 * todo lo demás, que es lo que separa la utilidad bruta de la ganancia de verdad.
 */
@Injectable()
export class GastosService {
  constructor(@Inject(DB) private readonly db: BaseDatos) {}

  async registrar(usuario: UsuarioSesion, datos: DatosGasto): Promise<Gasto> {
    const fecha = fechaDelDocumento(datos.fecha);
    return conIdempotencia(
      () => this.porClave(datos.claveIdempotencia),
      async () => {
        const id = await this.db.transaction(async (tx) => {
          const [categoria] = await tx
            .select({ activa: gastoCategorias.activa })
            .from(gastoCategorias)
            .where(eq(gastoCategorias.id, datos.categoriaId));
          if (!categoria) throw campoInvalido('categoriaId', 'Esa categoría no existe.');
          if (!categoria.activa) {
            throw campoInvalido('categoriaId', 'Esa categoría está dada de baja.');
          }

          const [gasto] = await tx
            .insert(gastos)
            .values({
              fecha,
              categoriaId: datos.categoriaId,
              concepto: datos.concepto,
              importe: datos.importe,
              metodoPago: datos.metodoPago,
              notas: datos.notas,
              usuarioId: usuario.id,
              claveIdempotencia: datos.claveIdempotencia,
            })
            .returning({ id: gastos.id });
          if (!gasto) throw new Error('No se registró el gasto');
          await registrarEnBitacora(tx, {
            usuarioId: usuario.id,
            accion: 'crear',
            entidad: 'gasto',
            entidadId: gasto.id,
            datos: { importe: datos.importe, concepto: datos.concepto },
          });
          return gasto.id;
        });
        return this.obtener(id);
      },
    );
  }

  /** Un gasto no se edita ni se borra: se cancela con motivo y queda a la vista. */
  async cancelar(usuario: UsuarioSesion, id: number, motivo: string): Promise<Gasto> {
    await this.db.transaction(async (tx) => {
      const [gasto] = await tx
        .select({ estado: gastos.estado })
        .from(gastos)
        .where(eq(gastos.id, id))
        .for('update');
      if (!gasto) throw new NotFoundException('El gasto no existe.');
      if (gasto.estado === 'cancelado')
        throw new ConflictException('El gasto ya estaba cancelado.');

      await tx
        .update(gastos)
        .set({
          estado: 'cancelado',
          canceladoEn: new Date(),
          canceladoPor: usuario.id,
          motivoCancelacion: motivo,
        })
        .where(eq(gastos.id, id));
      await registrarEnBitacora(tx, {
        usuarioId: usuario.id,
        accion: 'cancelar',
        entidad: 'gasto',
        entidadId: id,
        datos: { motivo },
      });
    });
    return this.obtener(id);
  }

  async listar(filtro: FiltroGastos): Promise<ListaGastos> {
    const condiciones: SQL[] = [];
    if (filtro.desde) condiciones.push(gte(gastos.fecha, filtro.desde));
    if (filtro.hasta) condiciones.push(lte(gastos.fecha, filtro.hasta));
    if (filtro.categoriaId) condiciones.push(eq(gastos.categoriaId, filtro.categoriaId));
    if (filtro.estado) condiciones.push(eq(gastos.estado, filtro.estado));
    const donde = condiciones.length > 0 ? and(...condiciones) : undefined;
    const vigentes = and(...condiciones, eq(gastos.estado, 'vigente'));

    const [filas, [conteo], porCategoria] = await Promise.all([
      this.consulta()
        .where(donde)
        .orderBy(desc(gastos.fecha), desc(gastos.id))
        .limit(POR_PAGINA)
        .offset((filtro.pagina - 1) * POR_PAGINA),
      this.db.select({ total: count() }).from(gastos).where(donde),
      this.db
        .select({
          categoria: gastoCategorias.nombre,
          importe: sql<string>`coalesce(sum(${gastos.importe}), 0)::numeric(12, 2)`,
        })
        .from(gastos)
        .innerJoin(gastoCategorias, eq(gastoCategorias.id, gastos.categoriaId))
        .where(vigentes)
        .groupBy(gastoCategorias.nombre)
        .orderBy(asc(gastoCategorias.nombre)),
    ]);

    return {
      filas: filas.map((fila) => this.aGasto(fila)),
      total: conteo?.total ?? 0,
      pagina: filtro.pagina,
      porPagina: POR_PAGINA,
      resumen: {
        importe: sumar(porCategoria.map((fila) => fila.importe)),
        porCategoria,
      },
    };
  }

  async obtener(id: number): Promise<Gasto> {
    const [fila] = await this.consulta().where(eq(gastos.id, id));
    if (!fila) throw new NotFoundException('El gasto no existe.');
    return this.aGasto(fila);
  }

  /* ---- Categorías ---- */

  async categorias(): Promise<Categoria[]> {
    return this.db
      .select()
      .from(gastoCategorias)
      .orderBy(asc(gastoCategorias.orden), asc(gastoCategorias.nombre));
  }

  async crearCategoria(datos: DatosCategoria): Promise<Categoria> {
    const [creada] = await this.db.insert(gastoCategorias).values(datos).returning();
    if (!creada) throw new Error('No se creó la categoría');
    return creada;
  }

  async actualizarCategoria(id: number, datos: DatosCategoria): Promise<Categoria> {
    const [actualizada] = await this.db
      .update(gastoCategorias)
      .set(datos)
      .where(eq(gastoCategorias.id, id))
      .returning();
    if (!actualizada) throw new NotFoundException('La categoría no existe.');
    return actualizada;
  }

  /* ---- internos ---- */

  private consulta() {
    return this.db
      .select({
        id: gastos.id,
        folio: gastos.folio,
        fecha: gastos.fecha,
        categoriaId: gastos.categoriaId,
        categoria: gastoCategorias.nombre,
        concepto: gastos.concepto,
        importe: gastos.importe,
        metodoPago: gastos.metodoPago,
        notas: gastos.notas,
        registradoPor: registradoPor.nombre,
        registradoEn: gastos.registradoEn,
        estado: gastos.estado,
        canceladoEn: gastos.canceladoEn,
        canceladoPor: canceladoPor.nombre,
        motivoCancelacion: gastos.motivoCancelacion,
      })
      .from(gastos)
      .innerJoin(gastoCategorias, eq(gastoCategorias.id, gastos.categoriaId))
      .innerJoin(registradoPor, eq(registradoPor.id, gastos.usuarioId))
      .leftJoin(canceladoPor, eq(canceladoPor.id, gastos.canceladoPor))
      .$dynamic();
  }

  private aGasto({
    canceladoEn,
    canceladoPor: por,
    motivoCancelacion,
    registradoEn,
    ...fila
  }: Awaited<ReturnType<GastosService['consulta']>>[number]): Gasto {
    return {
      ...fila,
      registradoEn: registradoEn.toISOString(),
      cancelacion: canceladoEn
        ? { en: canceladoEn.toISOString(), por: por ?? '', motivo: motivoCancelacion ?? '' }
        : null,
    };
  }

  private async porClave(clave: string): Promise<Gasto | null> {
    const [fila] = await this.db
      .select({ id: gastos.id })
      .from(gastos)
      .where(eq(gastos.claveIdempotencia, clave));
    return fila ? this.obtener(fila.id) : null;
  }
}

function campoInvalido(campo: string, mensaje: string): UnprocessableEntityException {
  return new UnprocessableEntityException({ mensaje, campos: { [campo]: mensaje } });
}
