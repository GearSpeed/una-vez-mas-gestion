import type { NestExpressApplication } from '@nestjs/platform-express';
import { configurarZodEnEspanol } from '@uvm/compartido';
import helmet from 'helmet';
import { sinCache } from './comun/cache.js';
import { soloMismoOrigen } from './comun/origen.js';
import { AlmacenImagenes } from './imagenes/almacen-imagenes.js';

/**
 * Lo que comparten `main.ts` y las pruebas: prefijo /api, cabeceras de
 * seguridad y la defensa contra CSRF.
 */
export function configurarApp(app: NestExpressApplication): void {
  // Las fotos de producto se sirven desde el bucket, no desde la app.
  const origenImagenes = app.get(AlmacenImagenes).origen;
  configurarZodEnEspanol();
  app.setGlobalPrefix('api');
  /**
   * El cuerpo JSON más grande que la API acepta de verdad es un conteo físico de
   * 500 productos: unos 25 KB. Con 64 KB sobra el margen, y nadie puede ocupar
   * memoria mandando cuerpos enormes.
   *
   * Va declarado y con prueba a propósito: Express trae 100 KB de fábrica, pero un
   * límite que nadie escribió es un límite que se pierde sin que nadie lo note. Las
   * fotos no pasan por aquí: van por multipart, con su propio tope de 10 MB.
   */
  app.useBodyParser('json', { limit: '64kb' });
  app.disable('x-powered-by');
  // La IP real la pone Cloudflare en CF-Connecting-IP (ver comun/limite-peticiones.ts);
  // no se confía en X-Forwarded-For, que cualquiera puede escribir.
  app.set('trust proxy', false);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'default-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'https://fonts.gstatic.com'],
          'img-src': ["'self'", 'data:', 'blob:', ...(origenImagenes ? [origenImagenes] : [])],
          'script-src': ["'self'"],
          'connect-src': ["'self'"],
          'frame-ancestors': ["'none'"],
        },
      },
    }),
  );
  app.use('/api', soloMismoOrigen);
  app.use('/api', sinCache);
}
