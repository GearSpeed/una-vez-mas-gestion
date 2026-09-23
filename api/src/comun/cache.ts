import type { NextFunction, Request, Response } from 'express';

/**
 * Nada de la API se guarda en la caché del navegador: ahí viajan ventas, costos y
 * correos, y el equipo entra desde equipos compartidos. La única excepción es la
 * ruta pública del catálogo, que pone su propia cabecera después de esta.
 */
export function sinCache(_solicitud: Request, respuesta: Response, siguiente: NextFunction): void {
  respuesta.setHeader('Cache-Control', 'no-store');
  siguiente();
}
