import { S3Client } from '@aws-sdk/client-s3';

export interface DatosBucket {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKey: string;
  readonly secretKey: string;
}

/**
 * Cinco intentos en lugar de los tres de fábrica. Tanto R2 como MinIO cierran de
 * vez en cuando una conexión reutilizada (`ECONNRESET`), y los reintentos del SDK
 * ocurren en milisegundos: con tres, a veces se agotan todos contra el mismo
 * tropiezo y la subida falla sin motivo.
 */
const INTENTOS = 5;

/**
 * Sin esto, el SDK espera para siempre: su modo de fábrica en Node deja los dos
 * timeouts en infinito, así que un socket colgado nunca se vuelve error y los cinco
 * intentos de arriba no llegan a usarse. La petición se queda esperando —en las
 * pruebas hasta que vitest la corta; en producción, una foto que no termina de
 * subir—. Con un límite, el cuelgue se vuelve `TimeoutError`, que sí se reintenta.
 *
 * Treinta segundos son holgados: lo que viaja son las dos WebP ya procesadas, de
 * unos cientos de kB, no el original de hasta 10 MB.
 */
const CONEXION_MS = 3_000;
const PETICION_MS = 30_000;

/** El cliente S3 con el que se habla al bucket, igual en desarrollo y en producción. */
export function crearClienteS3(datos: DatosBucket): S3Client {
  return new S3Client({
    endpoint: datos.endpoint,
    region: datos.region,
    forcePathStyle: true,
    maxAttempts: INTENTOS,
    requestHandler: { connectionTimeout: CONEXION_MS, requestTimeout: PETICION_MS },
    credentials: { accessKeyId: datos.accessKey, secretAccessKey: datos.secretKey },
  });
}
