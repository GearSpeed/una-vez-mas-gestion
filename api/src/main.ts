import 'reflect-metadata';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { cargarArchivoEnv } from './config/cargar-env.js';
import { ENTORNO, type Entorno } from './config/entorno.js';
import { configurarApp } from './configurar-app.js';

cargarArchivoEnv();

const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
app.enableShutdownHooks();
configurarApp(app);

const entorno = app.get<Entorno>(ENTORNO);

// En producción la misma API sirve el front: un solo origen, sin CORS.
if (entorno.WEB_DIST) {
  const carpeta = entorno.WEB_DIST;
  app.useStaticAssets(carpeta, {
    index: false,
    setHeaders: (respuesta, ruta) => {
      // Los bundles llevan hash en el nombre: nunca cambian. El index.html no se
      // cachea nunca: es el que apunta a los bundles nuevos tras cada despliegue.
      const conHash = /-[A-Z0-9]{8,}\.(js|css)$/i.test(ruta);
      const esIndice = ruta.endsWith('index.html');
      respuesta.setHeader(
        'Cache-Control',
        esIndice
          ? 'no-cache'
          : conHash
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=3600',
      );
    },
  });
  // Cualquier ruta que no sea de la API es una pantalla de la SPA.
  app.use((solicitud: Request, respuesta: Response, siguiente: NextFunction) => {
    if (solicitud.method !== 'GET' || solicitud.path.startsWith('/api')) return siguiente();
    respuesta.setHeader('Cache-Control', 'no-cache');
    respuesta.sendFile(join(carpeta, 'index.html'));
  });
}

await app.listen(entorno.PUERTO);
