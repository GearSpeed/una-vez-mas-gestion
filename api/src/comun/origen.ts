import type { NextFunction, Request, Response } from 'express';

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Defensa contra CSRF: una escritura solo se acepta si el navegador dice que
 * viene del mismo origen. Los navegadores actuales siempre mandan
 * Sec-Fetch-Site; un cliente que no es navegador (curl, pruebas) no lo manda y
 * tampoco trae la cookie de Access de nadie.
 */
export function soloMismoOrigen(
  solicitud: Request,
  respuesta: Response,
  siguiente: NextFunction,
): void {
  if (METODOS_SEGUROS.has(solicitud.method)) return siguiente();
  const sitio = solicitud.header('sec-fetch-site');
  if (sitio === undefined || sitio === 'same-origin' || sitio === 'none') return siguiente();
  respuesta.status(403).json({ mensaje: 'Se rechazó una petición que venía de otro sitio.' });
}
