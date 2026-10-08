import { createHash } from 'node:crypto';
import { UnprocessableEntityException } from '@nestjs/common';
import sharp, { type Sharp } from 'sharp';

/** Lo más que se acepta subir. */
export const PESO_MAXIMO_IMAGEN = 10 * 1024 * 1024;

/** Las dos que se guardan: la grande para el detalle y la chica para las listas. */
export const ANCHOS_IMAGEN = { grande: 1200, chica: 600 } as const;

const FORMATOS = new Set(['jpeg', 'png', 'webp']);

/**
 * 25 megapíxeles: más que cualquier foto de celular y poco para una bomba de
 * descompresión (un PNG de pocos MB puede declarar cientos de megapíxeles y pedir
 * gigabytes al decodificarse).
 */
const PIXELES_MAXIMOS = 25_000_000;

// Una foto a la vez: libvips reparte hilos por imagen y varias subidas a la vez
// multiplican la memoria del proceso.
sharp.concurrency(1);
let cola: Promise<unknown> = Promise.resolve();

/** Encola una tarea pesada para que no se procesen dos imágenes al mismo tiempo. */
function enCola<T>(tarea: () => Promise<T>): Promise<T> {
  const resultado = cola.then(tarea, tarea);
  cola = resultado.catch(() => undefined);
  return resultado;
}

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
export function procesarImagen(original: Buffer): Promise<ImagenProcesada> {
  return enCola(() => convertir(original));
}

/**
 * Revisa que el archivo de verdad sea JPG, PNG o WebP (por su contenido, no por la
 * extensión) y devuelve cómo abrirlo con los mismos topes de seguridad.
 */
async function abrir(original: Buffer): Promise<() => Sharp> {
  if (original.length === 0) throw invalida('El archivo está vacío.');
  if (original.length > PESO_MAXIMO_IMAGEN) throw invalida('La imagen pesa más de 10 MB.');

  const entrada = () => sharp(original, { failOn: 'error', limitInputPixels: PIXELES_MAXIMOS });
  let formato: string | undefined;
  try {
    formato = (await entrada().metadata()).format;
  } catch {
    throw invalida('El archivo no es una imagen.');
  }
  if (!formato || !FORMATOS.has(formato)) {
    throw invalida('Sube una imagen JPG, PNG o WebP.');
  }
  return entrada;
}

async function convertir(original: Buffer): Promise<ImagenProcesada> {
  const entrada = await abrir(original);

  // El original se decodifica una sola vez; la chica sale de la grande, que ya está
  // enderezada, limpia de metadatos y es mucho más barata de procesar.
  const grande = await entrada()
    .rotate()
    .resize({ width: ANCHOS_IMAGEN.grande, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  const chica = await sharp(grande)
    .resize({ width: ANCHOS_IMAGEN.chica, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  const huella = createHash('sha256').update(original).digest('hex').slice(0, 16);
  return { huella, grande, chica };
}

/** Lo más ancho que se guarda el QR: de sobra para escanearlo de una pantalla. */
export const ANCHO_MAXIMO_QR = 1024;

/**
 * Prepara el QR de transferencia: mismas revisiones que una foto, pero sale en PNG
 * sin pérdida. El WebP de las fotos emborrona los bordes de los módulos y un QR
 * así puede dejar de leerse.
 */
export function procesarQr(original: Buffer): Promise<Buffer> {
  return enCola(async () => {
    const entrada = await abrir(original);
    return entrada()
      .rotate()
      .resize({
        width: ANCHO_MAXIMO_QR,
        height: ANCHO_MAXIMO_QR,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9 })
      .toBuffer();
  });
}

/** `productos/12/3f9a…` → `productos/12/3f9a…-1200.webp` */
export function claveDeVariante(clave: string, variante: keyof typeof ANCHOS_IMAGEN): string {
  return `${clave}-${ANCHOS_IMAGEN[variante]}.webp`;
}
