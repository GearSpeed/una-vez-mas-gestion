import { httpResource } from '@angular/common/http';
import { effect, signal } from '@angular/core';

/**
 * El QR de transferencia como URL local (`blob:`). La ruta exige sesión, así que no
 * se puede poner directo en un `<img>`: se descarga y se suelta al cambiar o al
 * destruirse el componente. Se llama en el contexto de inyección.
 *
 * @param hayQr cuándo pedirlo; sin QR no se hace la petición (respondería 404).
 */
export function qrDeTransferencia(hayQr: () => boolean) {
  const recurso = httpResource.blob(() => (hayQr() ? '/api/transferencia/qr' : undefined));
  const url = signal<string | null>(null);
  effect((alLimpiar) => {
    const imagen = hayQr() ? recurso.value() : undefined;
    if (!imagen) {
      url.set(null);
      return;
    }
    const local = URL.createObjectURL(imagen);
    url.set(local);
    alLimpiar(() => URL.revokeObjectURL(local));
  });
  return { url: url.asReadonly(), recurso };
}
