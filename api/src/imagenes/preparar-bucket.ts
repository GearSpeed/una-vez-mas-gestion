import {
  BucketAlreadyOwnedByYou,
  CreateBucketCommand,
  PutBucketPolicyCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export interface DatosBucket {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKey: string;
  readonly secretKey: string;
}

/**
 * Crea el bucket (si no existe) y deja que cualquiera lea sus objetos: así los
 * sirve el sitio. Es para MinIO en desarrollo y en las pruebas. En producción no
 * hace falta: en R2 el bucket se crea en el panel y lo público es el dominio que se
 * le conecta, no una política del bucket (docs/despliegue.md).
 */
export async function prepararBucketPublico(datos: DatosBucket): Promise<void> {
  const cliente = new S3Client({
    endpoint: datos.endpoint,
    region: datos.region,
    forcePathStyle: true,
    credentials: { accessKeyId: datos.accessKey, secretAccessKey: datos.secretKey },
  });
  try {
    try {
      await cliente.send(new CreateBucketCommand({ Bucket: datos.bucket }));
    } catch (error) {
      if (!(error instanceof BucketAlreadyOwnedByYou)) throw error;
    }
    await cliente.send(
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
    );
  } finally {
    cliente.destroy();
  }
}
