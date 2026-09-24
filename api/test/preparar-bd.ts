import { resolve } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait } from 'testcontainers';
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

/**
 * MinIO, empaquetado por Bitnami: las imágenes oficiales dejaron de poder
 * descargarse sin credenciales, y esta copia sí es pública. Es el mismo servidor,
 * así que se comporta igual (política del bucket incluida).
 */
export const IMAGEN_MINIO = 'bitnamilegacy/minio:latest';
export const USUARIO_MINIO = 'pruebas';
export const CLAVE_MINIO = 'pruebas-secreto';

/** Un MinIO listo para usar, esperando a que pueda atender de verdad: `ready`, no `live`. */
export function contenedorMinio(): GenericContainer {
  return new GenericContainer(IMAGEN_MINIO)
    .withEnvironment({ MINIO_ROOT_USER: USUARIO_MINIO, MINIO_ROOT_PASSWORD: CLAVE_MINIO })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/minio/health/ready', 9000));
}

/**
 * Levanta un PostgreSQL 18 real con el mismo script de roles que producción
 * (db/init/01-roles.sh) y aplica las migraciones una vez para todas las pruebas.
 *
 * Si Docker Desktop está apagado y usas el motor del sistema:
 *   DOCKER_HOST=unix:///var/run/docker.sock npm run test:integracion
 */
export default async function preparar(proyecto: TestProject) {
  const minio = contenedorMinio().start();
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
    endpoint: `http://${s3.getHost()}:${s3.getMappedPort(9000)}`,
    bucket: 'imagenes',
    accessKey: USUARIO_MINIO,
    secretKey: CLAVE_MINIO,
  };
  await prepararBucketPublico({ ...bucket, region: 'us-east-1' });
  proyecto.provide('bucket', bucket);

  return async () => {
    await Promise.all([contenedor.stop(), s3.stop()]);
  };
}
