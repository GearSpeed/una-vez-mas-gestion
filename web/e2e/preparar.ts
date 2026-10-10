import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import sharp from 'sharp';
import { GenericContainer, Wait } from 'testcontainers';

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
  // MinIO empaquetado por Bitnami: las imágenes oficiales ya no se pueden descargar
  // sin credenciales (ver api/test/preparar-bd.ts).
  const minio = new GenericContainer('bitnamilegacy/minio:latest')
    .withEnvironment({ MINIO_ROOT_USER: 'pruebas', MINIO_ROOT_PASSWORD: 'pruebas-secreto' })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/minio/health/ready', 9000))
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
  const openAi = await openAiFalso();
  const urlMinio = `http://${s3.getHost()}:${s3.getMappedPort(9000)}`;

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
    S3_ENDPOINT: urlMinio,
    S3_BUCKET: 'imagenes',
    S3_ACCESS_KEY: 'pruebas',
    S3_SECRET_KEY: 'pruebas-secreto',
    IMAGENES_URL_PUBLICA: `${urlMinio}/imagenes`,
    // Nunca el OpenAI de verdad: la API carga el `.env` de la raíz, que puede traer una
    // llave real, pero no pisa lo que ya viene aquí.
    OPENAI_API_KEY: 'sk-e2e-falsa',
    OPENAI_URL_BASE: openAi.url,
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
    openAi.servidor.close();
    await Promise.all([contenedor.stop(), s3.stop()]);
  };
}

/**
 * Un OpenAI de mentiras: a cada imagen pedida contesta con un cuadro de color, y a cada
 * referencia que se le pide describir, con la misma sugerencia.
 */
async function openAiFalso() {
  const png = await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: '#b7034d' },
  })
    .png()
    .toBuffer();
  const servidor = createServer((solicitud, respuesta) => {
    solicitud.resume();
    solicitud.on('end', () => {
      respuesta.writeHead(200, { 'content-type': 'application/json' });
      if (solicitud.url === '/v1/responses') {
        const sugerencia = {
          nombre: 'Mesa de madera sugerida',
          prompt: 'Mesa de madera clara con luz cálida de mañana y fondo desenfocado.',
        };
        respuesta.end(
          JSON.stringify({
            output: [
              {
                type: 'message',
                content: [{ type: 'output_text', text: JSON.stringify(sugerencia) }],
              },
            ],
          }),
        );
        return;
      }
      respuesta.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
    });
  });
  await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
  const { port } = servidor.address() as AddressInfo;
  return { servidor, url: `http://127.0.0.1:${port}/v1` };
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
