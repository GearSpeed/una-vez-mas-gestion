import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  NotFoundException,
  Param,
  type PipeTransform,
  Put,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  type DatosTransferencia,
  type EntradaDatosTransferencia,
  type EntradaQrTransferencia,
  esquemaDatosTransferencia,
  esquemaQrTransferencia,
  POSICIONES_QR,
  type PosicionQr,
} from '@uvm/compartido';
import { Autenticado, RequierePermiso, UsuarioActual } from '../acceso/decoradores.js';
import { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { LIMITE_IMAGENES } from '../comun/limite-peticiones.js';
import { Validar } from '../comun/validar.js';
import { PESO_MAXIMO_IMAGEN } from '../imagenes/procesar-imagen.js';
import { TransferenciaService } from './transferencia.service.js';

/** Solo hay lugar 1 y 2: cualquier otro es una ruta que no existe. */
class PosicionQrPipe implements PipeTransform<string, PosicionQr> {
  transform(valor: string): PosicionQr {
    const posicion = POSICIONES_QR.find((p) => String(p) === valor);
    if (!posicion) throw new NotFoundException('Solo hay lugar para dos QR.');
    return posicion;
  }
}

@Controller('transferencia')
export class TransferenciaController {
  constructor(private readonly transferencia: TransferenciaService) {}

  /** Cualquiera con sesión: quien cobra le pasa estos datos al cliente. */
  @Get()
  @Autenticado()
  obtener(): Promise<DatosTransferencia | null> {
    return this.transferencia.obtener();
  }

  @Put()
  @RequierePermiso('productos.gestionar')
  guardar(
    @UsuarioActual() usuario: UsuarioSesion,
    @Body(new Validar(esquemaDatosTransferencia)) datos: EntradaDatosTransferencia,
  ): Promise<DatosTransferencia> {
    return this.transferencia.guardar(usuario, datos);
  }

  /** El PNG del QR. No se guarda en caché: si se cambia la cuenta, nadie ve el viejo. */
  @Get('qr/:posicion')
  @Autenticado()
  @Header('Cache-Control', 'private, no-store')
  async qr(@Param('posicion', PosicionQrPipe) posicion: PosicionQr): Promise<StreamableFile> {
    const qr = await this.transferencia.qr(posicion);
    if (!qr) throw new NotFoundException('En ese lugar no hay QR de transferencia.');
    return new StreamableFile(qr, { type: 'image/png' });
  }

  /**
   * Multipart: `titulo` y, opcional, `archivo` (JPG, PNG o WebP de hasta 10 MB). Sin
   * archivo solo cambia el título del QR que ya está.
   */
  @Put('qr/:posicion')
  @RequierePermiso('productos.gestionar')
  @Throttle(LIMITE_IMAGENES)
  @UseInterceptors(
    FileInterceptor('archivo', { limits: { fileSize: PESO_MAXIMO_IMAGEN, files: 1 } }),
  )
  guardarQr(
    @UsuarioActual() usuario: UsuarioSesion,
    @Param('posicion', PosicionQrPipe) posicion: PosicionQr,
    @Body(new Validar(esquemaQrTransferencia)) datos: EntradaQrTransferencia,
    @UploadedFile() archivo: { readonly buffer: Buffer } | undefined,
  ): Promise<DatosTransferencia> {
    return this.transferencia.guardarQr(usuario, posicion, datos, archivo?.buffer);
  }

  @Delete('qr/:posicion')
  @RequierePermiso('productos.gestionar')
  quitarQr(
    @UsuarioActual() usuario: UsuarioSesion,
    @Param('posicion', PosicionQrPipe) posicion: PosicionQr,
  ): Promise<DatosTransferencia> {
    return this.transferencia.quitarQr(usuario, posicion);
  }
}
