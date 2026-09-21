import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { ErrorApi } from '@uvm/compartido';
import type { Response } from 'express';
import { errorDePostgres } from './errores-postgres.js';

const MENSAJES_UNICOS: Readonly<Record<string, string>> = {
  usuarios_correo_unique: 'Ya hay un usuario con ese correo.',
  productos_slug_unique: 'Ya hay un producto con ese slug.',
  proveedores_nombre_unique: 'Ya hay un proveedor con ese nombre.',
  vehiculos_nombre_unique: 'Ya hay un vehículo con ese nombre.',
  categorias_nombre_unique: 'Ya hay una categoría con ese nombre.',
  ubicaciones_nombre_unique: 'Ya hay una ubicación con ese nombre.',
};

/**
 * Todos los errores salen con la misma forma, `{ mensaje, campos? }`, y en
 * español. Los de Postgres que se pueden explicar se traducen; el resto es un
 * 500 genérico que se registra en el log sin mostrar detalles al usuario.
 */
@Catch()
export class FiltroErrores implements ExceptionFilter {
  private readonly logger = new Logger('Errores');

  catch(error: unknown, host: ArgumentsHost): void {
    const { estado, cuerpo } = this.traducir(error);
    if (estado >= 500)
      this.logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    host.switchToHttp().getResponse<Response>().status(estado).json(cuerpo);
  }

  private traducir(error: unknown): { estado: number; cuerpo: ErrorApi } {
    if (error instanceof HttpException) return this.deHttp(error);

    const pg = errorDePostgres(error);
    if (pg?.code === '23514' && pg.constraint === 'existencias_no_negativas') {
      return { estado: 409, cuerpo: { mensaje: 'No hay existencia suficiente.' } };
    }
    if (pg?.code === '23514') {
      return { estado: 422, cuerpo: { mensaje: 'Los datos no cumplen una regla del inventario.' } };
    }
    if (pg?.code === '23505') {
      const mensaje =
        MENSAJES_UNICOS[pg.constraint ?? ''] ?? 'Ya existe un registro con esos datos.';
      return { estado: 409, cuerpo: { mensaje } };
    }
    if (pg?.code === '23503') {
      return { estado: 422, cuerpo: { mensaje: 'Hace referencia a algo que no existe.' } };
    }

    // Errores de Express antes de llegar a Nest (JSON mal formado, cuerpo enorme…)
    const estadoExpress = (error as { status?: unknown } | null)?.status;
    if (typeof estadoExpress === 'number' && estadoExpress >= 400 && estadoExpress < 500) {
      return { estado: estadoExpress, cuerpo: { mensaje: 'La petición no es válida.' } };
    }

    return { estado: 500, cuerpo: { mensaje: 'Algo falló de nuestro lado. Intenta de nuevo.' } };
  }

  private deHttp(error: HttpException): { estado: number; cuerpo: ErrorApi } {
    const estado = error.getStatus();
    const respuesta = error.getResponse();
    if (typeof respuesta === 'string') return { estado, cuerpo: { mensaje: respuesta } };

    const { mensaje, campos, message } = respuesta as {
      mensaje?: string;
      campos?: Record<string, string>;
      message?: string | string[];
    };
    let texto = mensaje ?? (Array.isArray(message) ? message.join('. ') : message) ?? error.message;
    if (estado === 404 && texto.startsWith('Cannot ')) texto = 'No existe esa ruta.';
    return { estado, cuerpo: campos ? { mensaje: texto, campos } : { mensaje: texto } };
  }
}
