import type { NextFunction, Request, Response } from 'express';

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

function rechazar(respuesta: Response): void {
  respuesta.status(403).json({ mensaje: 'Se rechazó una petición que venía de otro sitio.' });
}

/**
 * Defensa contra CSRF, en dos capas, porque detrás de Access el navegador manda la
 * cookie de identidad venga de donde venga la petición:
 *
 * 1. `Sec-Fetch-Site`: los navegadores actuales siempre la mandan y dicen si la
 *    petición salió del propio sitio.
 * 2. El `Content-Type` de los POST: un formulario de otra página solo puede mandar
 *    `text/plain`, `application/x-www-form-urlencoded` o `multipart/form-data`, y
 *    solo por POST. Exigir JSON deja fuera ese vector aunque la cabecera anterior
 *    falte (clientes viejos). El multipart, que sí usa el formulario de la imagen,
 *    se acepta solo cuando el navegador confirma que viene del mismo sitio. Un PUT o
 *    un DELETE cruzados no los puede hacer un formulario: necesitan permiso CORS,
 *    que esta API no da a nadie.
 */
export function soloMismoOrigen(
  solicitud: Request,
  respuesta: Response,
  siguiente: NextFunction,
): void {
  if (METODOS_SEGUROS.has(solicitud.method)) return siguiente();

  const sitio = solicitud.header('sec-fetch-site');
  if (sitio !== undefined && sitio !== 'same-origin' && sitio !== 'none')
    return rechazar(respuesta);

  if (solicitud.method !== 'POST') return siguiente();

  const tipo = solicitud.header('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (tipo === 'application/json') return siguiente();
  if (tipo === 'multipart/form-data' && sitio === 'same-origin') return siguiente();
  return rechazar(respuesta);
}
