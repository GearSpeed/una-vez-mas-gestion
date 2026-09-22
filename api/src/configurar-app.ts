import type { NestExpressApplication } from '@nestjs/platform-express';
import { configurarZodEnEspanol } from '@uvm/compartido';
import helmet from 'helmet';
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
  // Detrás de Cloudflare Tunnel: la IP real viene en las cabeceras del proxy.
  app.set('trust proxy', 'loopback');
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
}
