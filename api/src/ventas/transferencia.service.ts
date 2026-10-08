import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { DatosTransferencia, EntradaDatosTransferencia } from '@uvm/compartido';
import { eq, sql } from 'drizzle-orm';
import type { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { registrarEnBitacora } from '../comun/bitacora.js';
import { type BaseDatos, DB } from '../db/conexion.js';
import { datosTransferencia } from '../db/esquema.js';
import { procesarQr } from '../imagenes/procesar-imagen.js';

const FILA = 1;

/**
 * La cuenta a la que transfieren los clientes: banco, titular, CLABE y, si se subió,
 * el QR del banco. La captura el administrador y la ve quien cobra.
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
        tieneQr: sql<boolean>`${datosTransferencia.qr} is not null`,
      })
      .from(datosTransferencia)
      .where(eq(datosTransferencia.id, FILA));
    return fila ?? null;
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

  /** El PNG del QR, o null si no hay. */
  async qr(): Promise<Buffer | null> {
    const [fila] = await this.db
      .select({ qr: datosTransferencia.qr })
      .from(datosTransferencia)
      .where(eq(datosTransferencia.id, FILA));
    return fila?.qr ?? null;
  }

  async subirQr(usuario: UsuarioSesion, archivo: Buffer | undefined): Promise<DatosTransferencia> {
    if (!archivo) {
      throw new UnprocessableEntityException({
        mensaje: 'Elige una imagen.',
        campos: { archivo: 'Elige una imagen' },
      });
    }
    await this.obtenerOFallar();
    const qr = await procesarQr(archivo);
    await this.cambiarQr(usuario, qr, 'subir_qr_transferencia');
    return this.obtenerOFallar();
  }

  async quitarQr(usuario: UsuarioSesion): Promise<DatosTransferencia> {
    await this.obtenerOFallar();
    await this.cambiarQr(usuario, null, 'quitar_qr_transferencia');
    return this.obtenerOFallar();
  }

  private async cambiarQr(usuario: UsuarioSesion, qr: Buffer | null, accion: string) {
    await this.db.transaction(async (tx) => {
      await tx
        .update(datosTransferencia)
        .set({ qr, actualizadoEn: new Date() })
        .where(eq(datosTransferencia.id, FILA));
      await registrarEnBitacora(tx, {
        usuarioId: usuario.id,
        accion,
        entidad: 'datos_transferencia',
        entidadId: FILA,
      });
    });
  }

  private async obtenerOFallar(): Promise<DatosTransferencia> {
    const datos = await this.obtener();
    if (!datos) {
      throw new NotFoundException('Primero guarda el banco, el titular y la CLABE.');
    }
    return datos;
  }
}
