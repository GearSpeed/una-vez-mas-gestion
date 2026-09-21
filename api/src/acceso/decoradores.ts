import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permiso } from '@uvm/compartido';
import type { Request } from 'express';
import type { UsuarioSesion } from './usuario-sesion.js';

export const CLAVE_PERMISOS = 'uvm:permisos';
export const CLAVE_AUTENTICADO = 'uvm:autenticado';
export const CLAVE_PUBLICO = 'uvm:publico';

/**
 * La ruta exige al menos uno de estos permisos. Toda ruta debe declarar qué
 * exige (esto, `@Autenticado()` o `@Publico()`): si no, el guard la niega.
 */
export const RequierePermiso = (...permisos: [Permiso, ...Permiso[]]) =>
  SetMetadata(CLAVE_PERMISOS, permisos);

/** Basta con ser un usuario activo; el servicio decide qué ve cada quien. */
export const Autenticado = () => SetMetadata(CLAVE_AUTENTICADO, true);

/** Sin identidad (el chequeo de salud). */
export const Publico = () => SetMetadata(CLAVE_PUBLICO, true);

export type SolicitudConUsuario = Request & { usuario?: UsuarioSesion };

export const UsuarioActual = createParamDecorator(
  (_dato: unknown, contexto: ExecutionContext): UsuarioSesion => {
    const usuario = contexto.switchToHttp().getRequest<SolicitudConUsuario>().usuario;
    if (!usuario) throw new Error('UsuarioActual en una ruta sin guard de acceso');
    return usuario;
  },
);
