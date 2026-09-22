import { resolve } from 'node:path';
import { MinioContainer } from '@testcontainers/minio';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { migrar } from '../src/db/migrar.js';
import { prepararBucketPublico } from '../src/imagenes/preparar-bucket.js';

export interface UrlsBd {
  readonly owner: string;
  readonly app: string;
  readonly sitio: string;
}

/** El bucket de imágenes de las pruebas (MinIO). */
export interface Bucket {
  readonly endpoint: string;
  readonly bucket: string;
  readonly accessKey: string;
  readonly secretKey: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    urlsBd: UrlsBd;
    bucket: Bucket;
  }
}

export const IMAGEN_MINIO = 'quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z';

/**
 * Levanta un PostgreSQL 18 real con el mismo script de roles que producción
 * (db/init/01-roles.sh) y aplica las migraciones una vez para todas las pruebas.
 *
 * Si Docker Desktop está apagado y usas el motor del sistema:
 *   DOCKER_HOST=unix:///var/run/docker.sock npm run test:integracion
 */
export default async function preparar(proyecto: TestProject) {
  const minio = new MinioContainer(IMAGEN_MINIO)
    .withUsername('pruebas')
    .withPassword('pruebas-secreto')
    .start();
  const contenedor = await new PostgreSqlContainer('postgres:18-alpine')
    .withEnvironment({
      GESTION_OWNER_PASSWORD: 'owner',
      GESTION_APP_PASSWORD: 'app',
      SITIO_LECTURA_PASSWORD: 'sitio',
      TZ: 'America/Mexico_City',
    })
    .withCopyFilesToContainer([
      {
        source: resolve(import.meta.dirname, '../../db/init/01-roles.sh'),
        target: '/docker-entrypoint-initdb.d/01-roles.sh',
        mode: 0o755,
      },
    ])
    .start();

  const base = `${contenedor.getHost()}:${contenedor.getPort()}/gestion`;
  const urls: UrlsBd = {
    owner: `postgres://gestion_owner:owner@${base}`,
    app: `postgres://gestion_app:app@${base}`,
    sitio: `postgres://sitio_lectura:sitio@${base}`,
  };
  await migrar(urls.owner);
  proyecto.provide('urlsBd', urls);

  const s3 = await minio;
  const bucket: Bucket = {
    endpoint: s3.getConnectionUrl(),
    bucket: 'imagenes',
    accessKey: s3.getUsername(),
    secretKey: s3.getPassword(),
  };
  await prepararBucketPublico({ ...bucket, region: 'us-east-1' });
  proyecto.provide('bucket', bucket);

  return async () => {
    await Promise.all([contenedor.stop(), s3.stop()]);
  };
}
