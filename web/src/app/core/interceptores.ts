import type { HttpInterceptorFn } from '@angular/common/http';
import { SesionService } from './sesion';

/**
 * En desarrollo (sin Cloudflare Access) la API toma el usuario de
 * `X-Dev-Correo`. En producción la API ignora esta cabecera.
 */
export const correoDesarrolloInterceptor: HttpInterceptorFn = (solicitud, siguiente) => {
  const correo = SesionService.correoDesarrollo();
  if (!correo || !solicitud.url.startsWith('/api/')) return siguiente(solicitud);
  return siguiente(solicitud.clone({ setHeaders: { 'X-Dev-Correo': correo } }));
};
