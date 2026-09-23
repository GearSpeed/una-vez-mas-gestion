import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import type { SolicitudConUsuario } from '../acceso/decoradores.js';

/** Subir fotos cuesta CPU y memoria: 30 cada 5 minutos por usuario. */
export const LIMITE_IMAGENES = { default: { limit: 30, ttl: 5 * 60_000 } };

/** La ruta pública la puede llamar cualquiera, y la cachea Cloudflare: 60 por minuto. */
export const LIMITE_PUBLICO = { default: { limit: 60, ttl: 60_000 } };

/**
 * Cuenta las peticiones por usuario cuando hay sesión y, si no, por la IP real
 * del cliente. Detrás del túnel de Cloudflare la IP de la conexión es la del
 * contenedor `cloudflared`, la misma para todos: la buena viene en
 * `CF-Connecting-IP`, que Cloudflare pone y no se puede falsificar desde fuera.
 */
@Injectable()
export class LimitePeticionesGuard extends ThrottlerGuard {
  protected override async getTracker(solicitud: Request): Promise<string> {
    const correo = (solicitud as SolicitudConUsuario).usuario?.correo;
    if (correo) return `usuario:${correo}`;
    const ip = solicitud.header('cf-connecting-ip') ?? solicitud.ip ?? 'desconocida';
    return `ip:${ip}`;
  }
}
