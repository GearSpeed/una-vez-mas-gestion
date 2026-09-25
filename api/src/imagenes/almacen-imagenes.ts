import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DeleteObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ENTORNO, type Entorno } from '../config/entorno.js';
import { crearClienteS3 } from './cliente-s3.js';
import { ARCHIVO_PLACEHOLDER, CLAVE_PLACEHOLDER } from './placeholder.js';
import { claveDeVariante, type ImagenProcesada, procesarImagen } from './procesar-imagen.js';

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
export class AlmacenImagenes implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlmacenImagenes.name);
  private readonly cliente: S3Client | null;
  private readonly bucket: string;
  private readonly base: string;

  constructor(@Inject(ENTORNO) entorno: Entorno) {
    this.bucket = entorno.S3_BUCKET ?? '';
    this.base = entorno.IMAGENES_URL_PUBLICA ?? '';
    this.cliente =
      entorno.S3_ENDPOINT && entorno.S3_ACCESS_KEY && entorno.S3_SECRET_KEY
        ? crearClienteS3({
            endpoint: entorno.S3_ENDPOINT,
            region: entorno.S3_REGION,
            bucket: this.bucket,
            accessKey: entorno.S3_ACCESS_KEY,
            secretKey: entorno.S3_SECRET_KEY,
          })
        : null;
  }

  get configurado(): boolean {
    return this.cliente !== null;
  }

  /**
   * Publica el logo de relleno al arrancar. Se sube cada vez, sin preguntar si ya
   * está: son dos archivos pequeños y así el bucket se repara solo si alguien lo
   * borró. Si falla, la aplicación arranca igual: sin foto de relleno el sitio se
   * ve peor, pero nada más.
   */
  async onModuleInit(): Promise<void> {
    if (!this.cliente) return;
    try {
      const original = await readFile(resolve(import.meta.dirname, ARCHIVO_PLACEHOLDER));
      await this.subir(CLAVE_PLACEHOLDER, await procesarImagen(original));
    } catch (error) {
      this.logger.warn(`No se pudo publicar el logo de relleno: ${String(error)}`);
    }
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
