const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];
const PESO_MAXIMO = 10 * 1024 * 1024;

/** Lo mismo que revisa la API, antes de subir: el motivo, o `null` si está bien. */
export function revisarImagen(archivo: File): string | null {
  if (!TIPOS.includes(archivo.type)) return 'Elige una imagen JPG, PNG o WebP.';
  if (archivo.size > PESO_MAXIMO) return 'La imagen pesa más de 10 MB.';
  return null;
}
