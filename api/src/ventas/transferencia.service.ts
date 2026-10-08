import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  DatosTransferencia,
  EntradaDatosTransferencia,
  EntradaQrTransferencia,
  PosicionQr,
  QrTransferencia,
} from '@uvm/compartido';
import { asc, eq } from 'drizzle-orm';
import type { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { registrarEnBitacora } from '../comun/bitacora.js';
import { type BaseDatos, DB } from '../db/conexion.js';
import { datosTransferencia, qrTransferencia } from '../db/esquema.js';
import { procesarQr } from '../imagenes/procesar-imagen.js';

const FILA = 1;

/**
 * La cuenta a la que transfieren los clientes: banco, titular, CLABE y hasta dos QR
 * con su título (el principal y uno de respaldo). La captura el administrador y la ve quien cobra.
 */
@Injectable()
export class TransferenciaService {
  constructor(@Inject(DB) private readonly db: BaseDatos) {}

  /** null mientras nadie haya capturado los datos. */
  async obtener(): Promise<DatosTransferencia | null> {
    const [fila] = await this.db
      .select({
        banco: datosTransferencia.banco,
        titular: datosTransferencia.titular,
        clabe: datosTransferencia.clabe,
      })
      .from(datosTransferencia)
      .where(eq(datosTransferencia.id, FILA));
    if (!fila) return null;
    const qrs = await this.db
      .select({ posicion: qrTransferencia.posicion, titulo: qrTransferencia.titulo })
      .from(qrTransferencia)
      .orderBy(asc(qrTransferencia.posicion));
    return { ...fila, qrs: qrs as QrTransferencia[] };
  }

  async guardar(
    usuario: UsuarioSesion,
    datos: EntradaDatosTransferencia,
  ): Promise<DatosTransferencia> {
    await this.db.transaction(async (tx) => {
      const [antes] = await tx
        .select({
          banco: datosTransferencia.banco,
          titular: datosTransferencia.titular,
          clabe: datosTransferencia.clabe,
        })
        .from(datosTransferencia)
        .where(eq(datosTransferencia.id, FILA));
      await tx
        .insert(datosTransferencia)
        .values({ id: FILA, ...datos })
        .onConflictDoUpdate({
          target: datosTransferencia.id,
          set: { ...datos, actualizadoEn: new Date() },
        });
      await registrarEnBitacora(tx, {
        usuarioId: usuario.id,
        accion: 'cambiar_datos_transferencia',
        entidad: 'datos_transferencia',
        entidadId: FILA,
        datos: { antes: antes ?? null, despues: datos },
      });
    });
    return this.obtenerOFallar();
  }

  /** El PNG del QR en esa posición, o null si no hay. */
  async qr(posicion: PosicionQr): Promise<Buffer | null> {
    const [fila] = await this.db
      .select({ imagen: qrTransferencia.imagen })
      .from(qrTransferencia)
      .where(eq(qrTransferencia.posicion, posicion));
    return fila?.imagen ?? null;
  }

  /**
   * Sube el QR de esa posición o, sin archivo, solo le cambia el título. Un lugar
   * vacío no acepta título sin imagen.
   */
  async guardarQr(
    usuario: UsuarioSesion,
    posicion: PosicionQr,
    { titulo }: EntradaQrTransferencia,
    archivo: Buffer | undefined,
  ): Promise<DatosTransferencia> {
    await this.obtenerOFallar();
    const imagen = archivo ? await procesarQr(archivo) : undefined;
    await this.db.transaction(async (tx) => {
      const [antes] = await tx
        .select({ titulo: qrTransferencia.titulo })
        .from(qrTransferencia)
        .where(eq(qrTransferencia.posicion, posicion));
      if (imagen) {
        await tx
          .insert(qrTransferencia)
          .values({ posicion, titulo, imagen })
          .onConflictDoUpdate({
            target: qrTransferencia.posicion,
            set: { titulo, imagen, actualizadoEn: new Date() },
          });
      } else if (antes) {
        await tx
          .update(qrTransferencia)
          .set({ titulo, actualizadoEn: new Date() })
          .where(eq(qrTransferencia.posicion, posicion));
      } else {
        throw new UnprocessableEntityException({
          mensaje: 'Elige una imagen.',
          campos: { archivo: 'Elige una imagen' },
        });
      }
      await registrarEnBitacora(tx, {
        usuarioId: usuario.id,
        accion: imagen ? 'subir_qr_transferencia' : 'cambiar_titulo_qr_transferencia',
        entidad: 'qr_transferencia',
        entidadId: posicion,
        datos: { antes: antes ?? null, despues: { titulo } },
      });
    });
    return this.obtenerOFallar();
  }

  async quitarQr(usuario: UsuarioSesion, posicion: PosicionQr): Promise<DatosTransferencia> {
    await this.obtenerOFallar();
    await this.db.transaction(async (tx) => {
      const quitados = await tx
        .delete(qrTransferencia)
        .where(eq(qrTransferencia.posicion, posicion))
        .returning({ titulo: qrTransferencia.titulo });
      if (quitados.length === 0) throw new NotFoundException('En ese lugar no hay QR.');
      await registrarEnBitacora(tx, {
        usuarioId: usuario.id,
        accion: 'quitar_qr_transferencia',
        entidad: 'qr_transferencia',
        entidadId: posicion,
        datos: { antes: quitados[0] },
      });
    });
    return this.obtenerOFallar();
  }

  private async obtenerOFallar(): Promise<DatosTransferencia> {
    const datos = await this.obtener();
    if (!datos) {
      throw new NotFoundException('Primero guarda el banco, el titular y la CLABE.');
    }
    return datos;
  }
}
