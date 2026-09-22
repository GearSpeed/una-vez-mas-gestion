import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { MinioContainer } from '@testcontainers/minio';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

// Playwright carga este archivo como CommonJS (web/ no es "type": "module").
const RAIZ = resolve(__dirname, '../..');
export const ADMIN = 'admin@prueba.local';

/**
 * Levanta PostgreSQL 18 (con el mismo script de roles que producción) y MinIO para
 * las imágenes,
 * migra, siembra los datos de prueba y arranca la API compilada sirviendo el
 * front compilado en el puerto 3100. Devuelve la función que apaga todo.
 */
export default async function preparar(): Promise<() => Promise<void>> {
  const minio = new MinioContainer('quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z')
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
        source: resolve(RAIZ, 'db/init/01-roles.sh'),
        target: '/docker-entrypoint-initdb.d/01-roles.sh',
        mode: 0o755,
      },
    ])
    .start();
  const base = `${contenedor.getHost()}:${contenedor.getPort()}/gestion`;
  const s3 = await minio;

  const entorno = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL_MIGRACIONES: `postgres://gestion_owner:owner@${base}`,
    DATABASE_URL: `postgres://gestion_app:app@${base}`,
    ADMIN_INICIAL_CORREO: ADMIN,
    ADMIN_INICIAL_NOMBRE: 'Admin',
    AUTH_MODO: 'desarrollo',
    DEV_CORREO: ADMIN,
    PUERTO: '3100',
    WEB_DIST: resolve(RAIZ, 'web/dist/web/browser'),
    LOG_NIVEL: 'warn',
    S3_ENDPOINT: s3.getConnectionUrl(),
    S3_BUCKET: 'imagenes',
    S3_ACCESS_KEY: s3.getUsername(),
    S3_SECRET_KEY: s3.getPassword(),
    IMAGENES_URL_PUBLICA: `${s3.getConnectionUrl()}/imagenes`,
  };
  const api = resolve(RAIZ, 'api/dist');
  execFileSync('node', [resolve(api, 'cli/migrar.js')], { env: entorno, stdio: 'inherit' });
  execFileSync('node', [resolve(api, 'cli/semilla.js'), '--demo'], {
    env: entorno,
    stdio: 'inherit',
  });
  execFileSync('node', [resolve(api, 'cli/preparar-bucket.js')], {
    env: entorno,
    stdio: 'inherit',
  });

  const servidor: ChildProcess = spawn('node', [resolve(api, 'main.js')], {
    env: entorno,
    stdio: 'inherit',
  });
  await esperar('http://localhost:3100/api/salud');

  return async () => {
    servidor.kill();
    await Promise.all([contenedor.stop(), s3.stop()]);
  };
}

async function esperar(url: string): Promise<void> {
  for (let intento = 0; intento < 60; intento++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // todavía no escucha
    }
    await new Promise((listo) => setTimeout(listo, 500));
  }
  throw new Error(`La API no respondió en ${url}`);
}
