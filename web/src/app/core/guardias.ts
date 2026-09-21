import { inject } from '@angular/core';
import { type CanMatchFn, Router } from '@angular/router';
import type { Permiso } from '@uvm/compartido';
import { SesionService } from './sesion';

/** Sin sesión (correo no dado de alta, sin conexión…) se muestra la pantalla de acceso. */
export const conSesion: CanMatchFn = () =>
  inject(SesionService).sesion() !== null || inject(Router).createUrlTree(['/sin-acceso']);

/** La ruta pide al menos uno de estos permisos. */
export function requierePermiso(...permisos: Permiso[]): CanMatchFn {
  return () =>
    inject(SesionService).puede(...permisos) || inject(Router).createUrlTree(['/sin-permiso']);
}
