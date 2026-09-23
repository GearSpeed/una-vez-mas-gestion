import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permiso } from '@uvm/compartido';
import {
  CLAVE_AUTENTICADO,
  CLAVE_PERMISOS,
  CLAVE_PUBLICO,
  type SolicitudConUsuario,
} from './decoradores.js';
import { IdentidadService } from './identidad.service.js';
import { SesionesService } from './sesiones.service.js';

/**
 * Guard global. Para cada petición: quién es (Access), si está dado de alta y
 * activo, y si tiene alguno de los permisos que la ruta exige. Se niega por
 * omisión: una ruta que no declara qué exige no se puede usar.
 */
@Injectable()
export class AccesoGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly identidad: IdentidadService,
    private readonly sesiones: SesionesService,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const objetivos = [contexto.getHandler(), contexto.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(CLAVE_PUBLICO, objetivos)) return true;

    const solicitud = contexto.switchToHttp().getRequest<SolicitudConUsuario>();
    const correo = await this.identidad.correoDe(solicitud);
    const usuario = await this.sesiones.cargar(correo);
    if (!usuario) {
      throw new ForbiddenException('No tienes acceso. Pide al administrador que te dé de alta.');
    }
    solicitud.usuario = usuario;

    const permisos = this.reflector.getAllAndOverride<Permiso[] | undefined>(
      CLAVE_PERMISOS,
      objetivos,
    );
    if (permisos) {
      if (permisos.some((permiso) => usuario.puede(permiso))) return true;
      throw new ForbiddenException('No tienes permiso para hacer esto.');
    }
    if (this.reflector.getAllAndOverride<boolean>(CLAVE_AUTENTICADO, objetivos)) return true;

    throw new ForbiddenException('Esta ruta no declara qué permiso exige.');
  }
}
