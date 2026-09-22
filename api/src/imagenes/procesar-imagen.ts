import { createHash } from 'node:crypto';
import { UnprocessableEntityException } from '@nestjs/common';
import sharp from 'sharp';

/** Lo más que se acepta subir. */
export const PESO_MAXIMO_IMAGEN = 10 * 1024 * 1024;

/** Las dos que se guardan: la grande para el detalle y la chica para las listas. */
export const ANCHOS_IMAGEN = { grande: 1200, chica: 600 } as const;

const FORMATOS = new Set(['jpeg', 'png', 'webp']);

export interface ImagenProcesada {
  /** Huella del archivo original: la misma foto da la misma clave. */
  readonly huella: string;
  readonly grande: Buffer;
  readonly chica: Buffer;
}

function invalida(mensaje: string): UnprocessableEntityException {
  return new UnprocessableEntityException({ mensaje, campos: { archivo: mensaje } });
}

/**
 * Prepara la foto para el sitio: revisa que de verdad sea JPG, PNG o WebP (por su
 * contenido, no por la extensión), la endereza según su EXIF, le quita los
 * metadatos (fecha, cámara, GPS de las fotos de celular) y la deja en WebP de 1200
 * y 600 px de ancho, sin agrandar las que ya son más chicas.
 */
export async function procesarImagen(original: Buffer): Promise<ImagenProcesada> {
  if (original.length === 0) throw invalida('El archivo está vacío.');
  if (original.length > PESO_MAXIMO_IMAGEN) throw invalida('La imagen pesa más de 10 MB.');

  const entrada = () => sharp(original, { failOn: 'error', limitInputPixels: 60_000_000 });
  let formato: string | undefined;
  try {
    formato = (await entrada().metadata()).format;
  } catch {
    throw invalida('El archivo no es una imagen.');
  }
  if (!formato || !FORMATOS.has(formato)) {
    throw invalida('Sube una imagen JPG, PNG o WebP.');
  }

  const variante = (ancho: number) =>
    entrada()
      .rotate()
      .resize({ width: ancho, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  const [grande, chica] = await Promise.all([
    variante(ANCHOS_IMAGEN.grande),
    variante(ANCHOS_IMAGEN.chica),
  ]);
  const huella = createHash('sha256').update(original).digest('hex').slice(0, 16);
  return { huella, grande, chica };
}

/** `productos/12/3f9a…` → `productos/12/3f9a…-1200.webp` */
export function claveDeVariante(clave: string, variante: keyof typeof ANCHOS_IMAGEN): string {
  return `${clave}-${ANCHOS_IMAGEN[variante]}.webp`;
}
