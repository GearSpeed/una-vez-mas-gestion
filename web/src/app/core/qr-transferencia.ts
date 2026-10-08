import { httpResource } from '@angular/common/http';
import { effect, signal } from '@angular/core';
import type { PosicionQr } from '@uvm/compartido';

/**
 * Un QR de transferencia como URL local (`blob:`). La ruta exige sesión, así que no
 * se puede poner directo en un `<img>`: se descarga y se suelta al cambiar o al
 * destruirse el componente. Se llama en el contexto de inyección.
 *
 * @param posicion cuál pedir; con null no se hace la petición (respondería 404).
 */
export function qrDeTransferencia(posicion: () => PosicionQr | null) {
  const recurso = httpResource.blob(() => {
    const p = posicion();
    return p ? `/api/transferencia/qr/${p}` : undefined;
  });
  const url = signal<string | null>(null);
  effect((alLimpiar) => {
    const imagen = posicion() ? recurso.value() : undefined;
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
