import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  NotFoundException,
  Post,
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
  esquemaDatosTransferencia,
} from '@uvm/compartido';
import { Autenticado, RequierePermiso, UsuarioActual } from '../acceso/decoradores.js';
import { UsuarioSesion } from '../acceso/usuario-sesion.js';
import { LIMITE_IMAGENES } from '../comun/limite-peticiones.js';
import { Validar } from '../comun/validar.js';
import { PESO_MAXIMO_IMAGEN } from '../imagenes/procesar-imagen.js';
import { TransferenciaService } from './transferencia.service.js';

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
  @Get('qr')
  @Autenticado()
  @Header('Cache-Control', 'private, no-store')
  async qr(): Promise<StreamableFile> {
    const qr = await this.transferencia.qr();
    if (!qr) throw new NotFoundException('Todavía no hay QR de transferencia.');
    return new StreamableFile(qr, { type: 'image/png' });
  }

  /** Multipart: `archivo` (JPG, PNG o WebP de hasta 10 MB). */
  @Post('qr')
  @RequierePermiso('productos.gestionar')
  @Throttle(LIMITE_IMAGENES)
  @UseInterceptors(
    FileInterceptor('archivo', { limits: { fileSize: PESO_MAXIMO_IMAGEN, files: 1 } }),
  )
  subirQr(
    @UsuarioActual() usuario: UsuarioSesion,
    @UploadedFile() archivo: { readonly buffer: Buffer } | undefined,
  ): Promise<DatosTransferencia> {
    return this.transferencia.subirQr(usuario, archivo?.buffer);
  }

  @Delete('qr')
  @RequierePermiso('productos.gestionar')
  quitarQr(@UsuarioActual() usuario: UsuarioSesion): Promise<DatosTransferencia> {
    return this.transferencia.quitarQr(usuario);
  }
}
