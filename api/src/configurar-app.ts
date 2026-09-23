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
