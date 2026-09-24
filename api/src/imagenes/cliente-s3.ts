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

/** El cliente S3 con el que se habla al bucket, igual en desarrollo y en producción. */
export function crearClienteS3(datos: DatosBucket): S3Client {
  return new S3Client({
    endpoint: datos.endpoint,
    region: datos.region,
    forcePathStyle: true,
    maxAttempts: INTENTOS,
    credentials: { accessKeyId: datos.accessKey, secretAccessKey: datos.secretKey },
  });
}
