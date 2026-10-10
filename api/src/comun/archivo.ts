import { StreamableFile } from '@nestjs/common';

/** Respuesta de descarga: Nest pone las cabeceras. */
export function archivoDescarga(nombre: string, bytes: Uint8Array, tipo: string): StreamableFile {
  return new StreamableFile(Buffer.from(bytes), {
    type: tipo,
    disposition: `attachment; filename="${nombre}"`,
  });
}

export function archivoXlsx(nombre: string, bytes: Uint8Array): StreamableFile {
  return archivoDescarga(
    nombre,
    bytes,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
}
