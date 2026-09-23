import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ENTORNO, type Entorno } from '../config/entorno.js';
import { claveDeVariante, type ImagenProcesada } from './procesar-imagen.js';

export interface UrlsImagen {
  readonly url: string;
  readonly urlChica: string;
}

/**
 * El bucket de las imágenes: Cloudflare R2 en producción, MinIO en desarrollo y en
 * las pruebas; los dos hablan S3. Las fotos se sirven por el dominio propio que
 * apunta al bucket (`IMAGENES_URL_PUBLICA`), no por este endpoint, que solo acepta
 * peticiones firmadas.
 */
@Injectable()
export class AlmacenImagenes implements OnModuleDestroy {
  private readonly logger = new Logger(AlmacenImagenes.name);
  private readonly cliente: S3Client | null;
  private readonly bucket: string;
  private readonly base: string;

  constructor(@Inject(ENTORNO) entorno: Entorno) {
    this.bucket = entorno.S3_BUCKET ?? '';
    this.base = entorno.IMAGENES_URL_PUBLICA ?? '';
    this.cliente =
      entorno.S3_ENDPOINT && entorno.S3_ACCESS_KEY && entorno.S3_SECRET_KEY
        ? new S3Client({
            endpoint: entorno.S3_ENDPOINT,
            region: entorno.S3_REGION,
            forcePathStyle: true,
            credentials: {
              accessKeyId: entorno.S3_ACCESS_KEY,
              secretAccessKey: entorno.S3_SECRET_KEY,
            },
          })
        : null;
  }

  get configurado(): boolean {
    return this.cliente !== null;
  }

  /** Sube las dos variantes bajo `clave`. Son inmutables: la caché puede guardarlas un año. */
  async subir(clave: string, imagen: ImagenProcesada): Promise<void> {
    const cliente = this.cliente;
    if (!cliente) {
      this.logger.error('Faltan las variables S3_* e IMAGENES_URL_PUBLICA.');
      throw new ServiceUnavailableException('No se pueden guardar imágenes ahora mismo.');
    }
    await Promise.all(
      (['grande', 'chica'] as const).map((variante) =>
        cliente.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: claveDeVariante(clave, variante),
            Body: imagen[variante],
            ContentType: 'image/webp',
            CacheControl: 'public, max-age=31536000, immutable',
          }),
        ),
      ),
    );
  }

  /** Borra las dos variantes de una imagen que se reemplazó o se quitó. */
  async borrar(clave: string): Promise<void> {
    const cliente = this.cliente;
    if (!cliente) return;
    try {
      await Promise.all(
        (['grande', 'chica'] as const).map((variante) =>
          cliente.send(
            new DeleteObjectCommand({
              Bucket: this.bucket,
              Key: claveDeVariante(clave, variante),
            }),
          ),
        ),
      );
    } catch (error) {
      // Que no se caiga la operación del producto porque el bucket no respondió.
      this.logger.warn(`No se pudo borrar la imagen ${clave}: ${String(error)}`);
    }
  }

  urls(clave: string): UrlsImagen {
    return {
      url: `${this.base}/${claveDeVariante(clave, 'grande')}`,
      urlChica: `${this.base}/${claveDeVariante(clave, 'chica')}`,
    };
  }

  /** El origen de las imágenes, para la política de contenido del front. */
  get origen(): string | null {
    return this.base ? new URL(this.base).origin : null;
  }

  onModuleDestroy(): void {
    this.cliente?.destroy();
  }
}
