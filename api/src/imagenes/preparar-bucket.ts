import {
  BucketAlreadyOwnedByYou,
  CreateBucketCommand,
  PutBucketPolicyCommand,
} from '@aws-sdk/client-s3';
import { crearClienteS3, type DatosBucket } from './cliente-s3.js';

/** Cuánto se insiste cuando el almacén todavía no contesta, y cuánto se espera entre intentos. */
const INTENTOS = 10;
const ESPERA_MS = 1000;

/**
 * Crea el bucket (si no existe) y deja que cualquiera lea sus objetos: así los
 * sirve el sitio. Es para MinIO en desarrollo y en las pruebas. En producción no
 * hace falta: en R2 el bucket se crea en el panel y lo público es el dominio que se
 * le conecta, no una política del bucket (docs/despliegue.md).
 */
export async function prepararBucketPublico(datos: DatosBucket): Promise<void> {
  const cliente = crearClienteS3(datos);
  try {
    await insistiendo(async () => {
      try {
        await cliente.send(new CreateBucketCommand({ Bucket: datos.bucket }));
      } catch (error) {
        if (!(error instanceof BucketAlreadyOwnedByYou)) throw error;
      }
    });
    await insistiendo(() =>
      cliente.send(
        new PutBucketPolicyCommand({
          Bucket: datos.bucket,
          Policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: { AWS: ['*'] },
                Action: ['s3:GetObject'],
                Resource: [`arn:aws:s3:::${datos.bucket}/*`],
              },
            ],
          }),
        }),
      ),
    );
  } finally {
    cliente.destroy();
  }
}

/**
 * Repite mientras el almacén esté arrancando. MinIO acepta conexiones antes de
 * poder atenderlas: contesta a su chequeo de salud, pero corta la primera petición
 * («ClientDisconnected») hasta que termina de montar el disco.
 */
async function insistiendo(tarea: () => Promise<unknown>): Promise<void> {
  for (let intento = 1; ; intento++) {
    try {
      await tarea();
      return;
    } catch (error) {
      if (intento >= INTENTOS || !esPasajero(error)) throw error;
      await new Promise((listo) => setTimeout(listo, ESPERA_MS));
    }
  }
}

/** Errores de «todavía no estoy listo»: la conexión se cae o el servidor la corta. */
function esPasajero(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const codigo = (error as { Code?: string }).Code;
  const sistema = (error.cause as { code?: string } | undefined)?.code;
  return (
    codigo === 'ClientDisconnected' ||
    codigo === 'ServerBusy' ||
    codigo === 'SlowDown' ||
    error.name === 'TimeoutError' ||
    sistema === 'ECONNREFUSED' ||
    sistema === 'ECONNRESET' ||
    sistema === 'EPIPE'
  );
}
